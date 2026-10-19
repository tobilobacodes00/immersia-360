/**
 * The hub's logic, free of Cloudflare types so it can be tested in Node: the event log with its
 * sequence numbers, what a reconnecting screen is sent to catch up, and who receives what.
 * `room.ts` backs the log with the Durable Object's SQLite; the tests use the in-memory one below.
 */
import { deliversTo, type LiveMessage, type LivePublish, type LiveRole } from '@immersia/shared/live';

/** How many recent messages a room remembers. A screen further behind than this refetches the feed. */
export const LOG_RETAIN = 1000;

/** What the log keeps: the messages a publish produces. `hello` and `reset` are per connection. */
export type StoredMessage = Extract<LiveMessage, { type: 'item' | 'remove' | 'config' | 'queue' }>;

/** A connected screen, as the token vouched for it. */
export interface Subscriber {
  role: LiveRole;
  /** Display id, operator user id or booth device id. */
  sub: string;
}

export interface LogStorage {
  append(seq: number, message: StoredMessage): void;
  /** Retained messages written after `seq`, oldest first. */
  since(seq: number): StoredMessage[];
  /** Position of the oldest retained message, or null while the log is empty. */
  oldest(): number | null;
  /** Position of the newest message ever written; 0 while nothing has been. */
  head(): number;
  /** Drops everything but the newest `keepLast` messages. The head never moves backwards. */
  prune(keepLast: number): void;
}

export function toMessage(publish: LivePublish, seq: number): StoredMessage {
  return { ...publish, seq };
}

/**
 * Whether a subscriber is sent a message. Operators see everything; screens never see the queue;
 * a config change aimed at one display is for that display (and the operators managing it) only.
 */
export function receives(message: StoredMessage, subscriber: Subscriber): boolean {
  if (!deliversTo(message, subscriber.role)) return false;
  if (message.type !== 'config' || message.displayId === null) return true;
  return subscriber.role === 'operator' || (subscriber.role === 'display' && subscriber.sub === message.displayId);
}

/** The `since` a client asked to resume from: null when it didn't ask, undefined when it's malformed. */
export function parseSince(raw: string | null): number | null | undefined {
  if (raw === null || raw === '') return null;
  return /^\d{1,15}$/.test(raw) ? Number(raw) : undefined;
}

export class RoomLog {
  private readonly storage: LogStorage;
  private readonly retain: number;

  constructor(storage: LogStorage, retain = LOG_RETAIN) {
    // Pruning to nothing would let the head fall back and hand out positions twice.
    if (!Number.isInteger(retain) || retain < 1) throw new RangeError('A room must retain at least one message');
    this.storage = storage;
    this.retain = retain;
  }

  head(): number {
    return this.storage.head();
  }

  /** Writes a publish to the log at the next position and returns it as the message to broadcast. */
  publish(publish: LivePublish): StoredMessage {
    const message = toMessage(publish, this.storage.head() + 1);
    this.storage.append(message.seq, message);
    this.storage.prune(this.retain);
    return message;
  }

  /**
   * What to send a screen that just connected, ending in `hello` (which carries the position it is now
   * current at). With no `since` it has the feed already and only needs `hello`; a position the log
   * still covers is replayed (minus what this subscriber may not see); an older one can't be, so the
   * screen is told to refetch the whole feed.
   */
  replay(subscriber: Subscriber, since: number | null): LiveMessage[] {
    const head = this.storage.head();
    const hello: LiveMessage = { type: 'hello', seq: head };
    if (since === null || since >= head) return [hello];
    const oldest = this.storage.oldest();
    // Resuming from `oldest - 1` still gets every retained message; one step further back is a gap.
    if (!Number.isInteger(since) || oldest === null || since < oldest - 1) {
      return [{ type: 'reset', seq: head }, hello];
    }
    const missed = this.storage.since(since).filter((message) => receives(message, subscriber));
    return [...missed, hello];
  }
}

export class MemoryLogStorage implements LogStorage {
  private messages: StoredMessage[] = [];

  append(seq: number, message: StoredMessage): void {
    if (seq <= this.head()) throw new RangeError(`Position ${seq} is not after the head (${this.head()})`);
    this.messages.push(message);
  }

  since(seq: number): StoredMessage[] {
    return this.messages.filter((message) => message.seq > seq);
  }

  oldest(): number | null {
    return this.messages[0]?.seq ?? null;
  }

  head(): number {
    return this.messages.at(-1)?.seq ?? 0;
  }

  prune(keepLast: number): void {
    if (keepLast < 1) throw new RangeError('Keep at least one message');
    this.messages = this.messages.slice(-keepLast);
  }
}
