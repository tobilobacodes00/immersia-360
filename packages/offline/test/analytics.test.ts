import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { INGEST_MAX_EVENTS, type IngestBatch } from '@immersia/shared';
import {
  OUTBOX_MAX,
  OUTBOX_MAX_AGE_MS,
  enqueueAnalytics,
  flushAnalytics,
  pruneAnalytics,
  type SendResult,
} from '../src/analytics';
import { BoothDB } from '../src/db';

let db: BoothDB;
let n = 0;
beforeEach(async () => {
  db = new BoothDB(`analytics-${++n}`);
  await db.open();
});

const qr = (s: number) => ({ name: 'qr_shown', seconds_since_take: s });
const sender = (...results: SendResult[]) => {
  const batches: IngestBatch[] = [];
  let i = 0;
  return {
    batches,
    send: async (b: IngestBatch): Promise<SendResult> => {
      batches.push(b);
      return results[Math.min(i++, results.length - 1)] ?? { kind: 'ok' };
    },
  };
};

describe('the analytics outbox', () => {
  it('buffers events with a client id and the device time, oldest first', async () => {
    await enqueueAnalytics(db, 'device', qr(1), { eventId: 'e1', now: 1000 });
    await enqueueAnalytics(db, 'device', qr(2), { now: 2000 });
    const rows = await db.analytics.orderBy('seq').toArray();
    expect(rows.map((r) => r.at)).toEqual([1000, 2000]);
    expect(rows[0]!.eventId).toBe('e1');
    expect(rows[1]!.eventId).toBeNull();
    expect(new Set(rows.map((r) => r.clientId)).size).toBe(2);
  });

  it('sends what is waiting, then deletes it once the server has it', async () => {
    for (let i = 0; i < 3; i++) await enqueueAnalytics(db, 'device', qr(i), { now: 1000 + i });
    const s = sender({ kind: 'ok' });
    expect(await flushAnalytics(db, 'device', s.send, { now: () => 5000 })).toBe('sent');
    expect(s.batches).toHaveLength(1);
    expect(s.batches[0]!.sentAt).toBe(5000);
    expect(s.batches[0]!.events.map((e) => e.at)).toEqual([1000, 1001, 1002]);
    expect(await db.analytics.count()).toBe(0);
    expect(await flushAnalytics(db, 'device', s.send)).toBe('empty');
  });

  it('keeps everything when the network or the server fails, and sends the same ids again', async () => {
    await enqueueAnalytics(db, 'device', qr(1));
    const s = sender({ kind: 'retry' }, { kind: 'ok' });
    expect(await flushAnalytics(db, 'device', s.send)).toBe('retry');
    expect(await db.analytics.count()).toBe(1);
    expect(await flushAnalytics(db, 'device', s.send)).toBe('sent');
    // the retry carried the very same event id, so the server can recognise it
    expect(s.batches[1]!.events[0]!.id).toBe(s.batches[0]!.events[0]!.id);
    expect(await db.analytics.count()).toBe(0);
  });

  it('treats a thrown send as a retry, not a failure of the booth', async () => {
    await enqueueAnalytics(db, 'device', qr(1));
    const step = await flushAnalytics(db, 'device', () => Promise.reject(new Error('offline')));
    expect(step).toBe('retry');
    expect(await db.analytics.count()).toBe(1);
  });

  it('keeps events for a revoked device (it may be restored) and reports it', async () => {
    await enqueueAnalytics(db, 'device', qr(1));
    expect(await flushAnalytics(db, 'device', sender({ kind: 'unauthorized' }).send)).toBe('unauthorized');
    expect(await db.analytics.count()).toBe(1);
  });

  it('drops a batch the server will never accept, so it cannot block the ones behind it', async () => {
    await enqueueAnalytics(db, 'device', qr(1));
    expect(await flushAnalytics(db, 'device', sender({ kind: 'rejected' }).send)).toBe('dropped');
    expect(await db.analytics.count()).toBe(0);
  });

  it('sends at most one batch worth at a time, oldest first', async () => {
    for (let i = 0; i < INGEST_MAX_EVENTS + 5; i++) await enqueueAnalytics(db, 'device', qr(i), { now: 1000 + i });
    const s = sender({ kind: 'ok' });
    // The same clock the events were stamped with, or the prune would read them as days old.
    await flushAnalytics(db, 'device', s.send, { now: () => 2000 });
    expect(s.batches[0]!.events).toHaveLength(INGEST_MAX_EVENTS);
    expect(s.batches[0]!.events[0]!.at).toBe(1000);
    expect(await db.analytics.count()).toBe(5);
  });

  it('halves a batch the server finds too large, and drops a single event that is too large on its own', async () => {
    for (let i = 0; i < 4; i++) await enqueueAnalytics(db, 'device', qr(i), { now: 1000 + i });
    const s = sender({ kind: 'too_large' }, { kind: 'ok' });
    expect(await flushAnalytics(db, 'device', s.send, { now: () => 2000 })).toBe('sent');
    expect(s.batches.map((b) => b.events.length)).toEqual([4, 2]);
    expect(await db.analytics.count()).toBe(2);

    const lone = new BoothDB(`analytics-lone-${n}`);
    await lone.open();
    await enqueueAnalytics(lone, 'device', qr(1));
    expect(await flushAnalytics(lone, 'device', sender({ kind: 'too_large' }).send)).toBe('dropped');
    expect(await lone.analytics.count()).toBe(0);
  });

  it('keeps a booth and a display apart: each channel flushes only its own events', async () => {
    await enqueueAnalytics(db, 'device', qr(1));
    await enqueueAnalytics(db, 'display', { name: 'item_displayed', seconds_on_screen: 8 });
    const s = sender({ kind: 'ok' });
    await flushAnalytics(db, 'display', s.send);
    expect(s.batches[0]!.events).toHaveLength(1);
    expect((s.batches[0]!.events[0]!.event as { name: string }).name).toBe('item_displayed');
    expect(await db.analytics.count()).toBe(1);
    expect((await db.analytics.toArray())[0]!.channel).toBe('device');
  });

  it('is bounded: past the cap the oldest events go, the newest stay', async () => {
    await db.analytics.bulkAdd(
      Array.from({ length: OUTBOX_MAX }, (_, i) => ({
        channel: 'device' as const,
        clientId: `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
        eventId: null,
        at: 1000 + i,
        event: qr(i),
      })),
    );
    await enqueueAnalytics(db, 'device', qr(9999), { now: 999_999 });
    expect(await db.analytics.count()).toBe(OUTBOX_MAX);
    const oldest = await db.analytics.orderBy('seq').first();
    expect(oldest!.at).toBe(1001);
    expect((await db.analytics.orderBy('seq').last())!.at).toBe(999_999);
  });

  it('forgets events too old to be worth sending', async () => {
    const now = 10 * OUTBOX_MAX_AGE_MS;
    await enqueueAnalytics(db, 'device', qr(1), { now: now - OUTBOX_MAX_AGE_MS - 1 });
    await enqueueAnalytics(db, 'device', qr(2), { now: now - 1000 });
    await pruneAnalytics(db, now);
    expect((await db.analytics.toArray()).map((r) => r.at)).toEqual([now - 1000]);
  });

  it('never throws into the booth when storage is unavailable', async () => {
    const closed = new BoothDB(`analytics-closed-${n}`);
    await closed.open();
    closed.close();
    expect(await enqueueAnalytics(closed, 'device', qr(1))).toBe(false);
    expect(await flushAnalytics(closed, 'device', sender({ kind: 'ok' }).send)).toBe('retry');
  });
});
