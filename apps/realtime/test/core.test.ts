import { describe, expect, it } from 'vitest';
import type { DisplayItem, LiveMessage, LivePublish } from '@immersia/shared/live';
import { LOG_RETAIN, MemoryLogStorage, parseSince, receives, RoomLog, toMessage, type Subscriber } from '../src/core';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const item = (n = 1): DisplayItem => ({
  id: uuid(n),
  booth: 'photo',
  shortCode: 'ABC234',
  link: 'https://immersia.test/c/ABC234',
  media: { type: 'gif', url: '/m/ABC234.gif', poster: null, width: 600, height: 900 },
  at: '2026-10-01T12:00:00.000Z',
});

const publishItem = (n = 1): LivePublish => ({ type: 'item', item: item(n) });
const publishRemove = (n = 1): LivePublish => ({ type: 'remove', id: uuid(n) });
const publishConfig = (displayId: string | null): LivePublish => ({ type: 'config', displayId });
const publishQueue: LivePublish = { type: 'queue' };

const display = (sub = uuid(100)): Subscriber => ({ role: 'display', sub });
const station: Subscriber = { role: 'station', sub: 'booth-1' };
const operator: Subscriber = { role: 'operator', sub: 'user-1' };

/** `type:seq` for each message, so a replay reads at a glance. */
const outline = (messages: LiveMessage[]) => messages.map((message) => `${message.type}:${message.seq}`);

describe('RoomLog positions', () => {
  it('starts a new room at 0 and numbers messages from 1, one more each time', () => {
    const log = new RoomLog(new MemoryLogStorage());
    expect(log.head()).toBe(0);
    expect(log.publish(publishQueue).seq).toBe(1);
    expect(log.publish(publishQueue).seq).toBe(2);
    expect(log.publish(publishQueue).seq).toBe(3);
    expect(log.head()).toBe(3);
  });

  it('builds each kind of publish into a message carrying its position', () => {
    expect(toMessage(publishItem(2), 7)).toEqual({ type: 'item', seq: 7, item: item(2) });
    expect(toMessage(publishRemove(2), 8)).toEqual({ type: 'remove', seq: 8, id: uuid(2) });
    expect(toMessage(publishConfig(uuid(3)), 9)).toEqual({ type: 'config', seq: 9, displayId: uuid(3) });
    expect(toMessage(publishConfig(null), 10)).toEqual({ type: 'config', seq: 10, displayId: null });
    expect(toMessage(publishQueue, 11)).toEqual({ type: 'queue', seq: 11 });
  });

  it('does not touch the publish it was given', () => {
    const publish = publishItem();
    new RoomLog(new MemoryLogStorage()).publish(publish);
    expect(publish).toEqual(publishItem());
  });

  it('remembers the last 1000 messages and no more', () => {
    const storage = new MemoryLogStorage();
    const log = new RoomLog(storage);
    expect(LOG_RETAIN).toBe(1000);
    for (let i = 0; i < 1500; i++) log.publish(publishQueue);
    expect(storage.since(0)).toHaveLength(1000);
    expect(storage.oldest()).toBe(501);
    expect(log.head()).toBe(1500);
  });

  it('keeps counting forwards after old messages are pruned', () => {
    const log = new RoomLog(new MemoryLogStorage(), 3);
    for (let i = 0; i < 10; i++) log.publish(publishQueue);
    expect(log.publish(publishQueue).seq).toBe(11);
    expect(log.head()).toBe(11);
  });

  it('refuses to retain nothing, which would let positions repeat', () => {
    expect(() => new RoomLog(new MemoryLogStorage(), 0)).toThrow(RangeError);
    expect(() => new RoomLog(new MemoryLogStorage(), 1.5)).toThrow(RangeError);
  });

  it('refuses a position that is not after the head', () => {
    const storage = new MemoryLogStorage();
    storage.append(1, toMessage(publishQueue, 1));
    expect(() => storage.append(1, toMessage(publishQueue, 1))).toThrow(RangeError);
  });
});

describe('RoomLog replay', () => {
  /** Eight messages with room for five: positions 4..8 are retained. */
  function eightAtFive() {
    const log = new RoomLog(new MemoryLogStorage(), 5);
    for (let i = 1; i <= 8; i++) log.publish(publishRemove(i));
    return log;
  }

  it('sends only hello to a screen that did not ask to resume', () => {
    expect(outline(eightAtFive().replay(display(), null))).toEqual(['hello:8']);
  });

  it('sends only hello to a screen that is already current, or somehow ahead', () => {
    const log = eightAtFive();
    expect(outline(log.replay(display(), 8))).toEqual(['hello:8']);
    expect(outline(log.replay(display(), 12))).toEqual(['hello:8']);
  });

  it('replays what a screen missed, then hello', () => {
    const log = eightAtFive();
    expect(outline(log.replay(display(), 7))).toEqual(['remove:8', 'hello:8']);
    expect(outline(log.replay(display(), 5))).toEqual(['remove:6', 'remove:7', 'remove:8', 'hello:8']);
  });

  it('still replays everything from one before the oldest retained message', () => {
    expect(outline(eightAtFive().replay(display(), 3))).toEqual([
      'remove:4',
      'remove:5',
      'remove:6',
      'remove:7',
      'remove:8',
      'hello:8',
    ]);
  });

  it('tells a screen that fell further behind than the log reaches to refetch, then hello', () => {
    const log = eightAtFive();
    expect(outline(log.replay(display(), 2))).toEqual(['reset:8', 'hello:8']);
    expect(outline(log.replay(display(), 0))).toEqual(['reset:8', 'hello:8']);
  });

  it('resumes from 0 in a room that has lost nothing', () => {
    const log = new RoomLog(new MemoryLogStorage());
    log.publish(publishQueue);
    log.publish(publishRemove());
    expect(outline(log.replay(operator, 0))).toEqual(['queue:1', 'remove:2', 'hello:2']);
  });

  it('treats a position that is not a whole number as lost', () => {
    const log = eightAtFive();
    expect(outline(log.replay(display(), 6.5))).toEqual(['reset:8', 'hello:8']);
    expect(outline(log.replay(display(), Number.NaN))).toEqual(['reset:8', 'hello:8']);
  });

  it('says hello at 0 for a room nothing has been published to', () => {
    const log = new RoomLog(new MemoryLogStorage());
    expect(log.replay(display(), null)).toEqual([{ type: 'hello', seq: 0 }]);
    expect(log.replay(display(), 0)).toEqual([{ type: 'hello', seq: 0 }]);
    expect(log.replay(display(), 5)).toEqual([{ type: 'hello', seq: 0 }]);
  });

  it('replays only what the subscriber may receive', () => {
    const mine = uuid(100);
    const log = new RoomLog(new MemoryLogStorage());
    log.publish(publishItem()); // 1
    log.publish(publishQueue); // 2
    log.publish(publishConfig(mine)); // 3
    log.publish(publishConfig(uuid(200))); // 4
    log.publish(publishConfig(null)); // 5
    log.publish(publishRemove()); // 6

    expect(outline(log.replay(display(mine), 0))).toEqual(['item:1', 'config:3', 'config:5', 'remove:6', 'hello:6']);
    expect(outline(log.replay(display(uuid(300)), 0))).toEqual(['item:1', 'config:5', 'remove:6', 'hello:6']);
    expect(outline(log.replay(station, 0))).toEqual(['item:1', 'config:5', 'remove:6', 'hello:6']);
    expect(outline(log.replay(operator, 0))).toEqual([
      'item:1',
      'queue:2',
      'config:3',
      'config:4',
      'config:5',
      'remove:6',
      'hello:6',
    ]);
  });

  it('still advances a screen past messages it was not sent', () => {
    const log = new RoomLog(new MemoryLogStorage());
    log.publish(publishQueue);
    log.publish(publishQueue);
    expect(log.replay(display(), 0)).toEqual([{ type: 'hello', seq: 2 }]);
  });
});

describe('who receives a message', () => {
  const mine = uuid(100);
  const queue = toMessage(publishQueue, 1);
  const item1 = toMessage(publishItem(), 2);
  const remove1 = toMessage(publishRemove(), 3);
  const everyone = toMessage(publishConfig(null), 4);
  const targeted = toMessage(publishConfig(mine), 5);

  it('shows the approval queue to operators only', () => {
    expect(receives(queue, operator)).toBe(true);
    expect(receives(queue, display())).toBe(false);
    expect(receives(queue, station)).toBe(false);
  });

  it('shows items and removals to every role', () => {
    for (const subscriber of [display(), station, operator]) {
      expect(receives(item1, subscriber)).toBe(true);
      expect(receives(remove1, subscriber)).toBe(true);
    }
  });

  it('sends an event-wide config change to every role', () => {
    for (const subscriber of [display(), station, operator]) expect(receives(everyone, subscriber)).toBe(true);
  });

  it('sends a config change aimed at one display to that display and to operators', () => {
    expect(receives(targeted, display(mine))).toBe(true);
    expect(receives(targeted, operator)).toBe(true);
  });

  it('keeps a targeted config change from other displays and from stations', () => {
    expect(receives(targeted, display(uuid(200)))).toBe(false);
    expect(receives(targeted, station)).toBe(false);
    // Only a display's own id counts: a station that happens to carry the same sub is still a station.
    expect(receives(targeted, { role: 'station', sub: mine })).toBe(false);
  });
});

describe('parseSince', () => {
  it('reads a position, and treats a missing or empty one as "not resuming"', () => {
    expect(parseSince('0')).toBe(0);
    expect(parseSince('42')).toBe(42);
    expect(parseSince(null)).toBeNull();
    expect(parseSince('')).toBeNull();
  });

  it('rejects anything else', () => {
    for (const bad of ['-1', '1.5', 'abc', '1e3', ' 4', '0x10', '1234567890123456789']) {
      expect(parseSince(bad)).toBeUndefined();
    }
  });
});
