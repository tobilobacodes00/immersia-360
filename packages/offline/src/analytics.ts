import { INGEST_MAX_EVENTS, uuidv7, type IngestBatch } from '@immersia/shared';
import type { AnalyticsChannel, BoothDB, LocalAnalyticsEvent } from './db';

/**
 * The analytics outbox. A booth in a hall with bad Wi-Fi still reports what it did: events are
 * written to the device database as they happen and flushed to POST /api/t in batches, with backoff,
 * whenever the network allows. Analytics sits strictly behind the booth's real work: nothing here
 * throws into a caller, the outbox is bounded (it never fills the device's storage), and a failed
 * flush leaves the events for the next one.
 */

/** The most events kept waiting; beyond this the oldest are dropped. */
export const OUTBOX_MAX = 2000;
/** Events older than this are not worth sending: the server would date them against its own retention. */
export const OUTBOX_MAX_AGE_MS = 7 * 86_400_000;

/**
 * Buffer one event. Returns false when it could not be stored (storage full or blocked, the
 * database closed): the caller carries on, the event is simply lost.
 */
export async function enqueueAnalytics(
  db: BoothDB,
  channel: AnalyticsChannel,
  event: { name: string } & Record<string, unknown>,
  opts: { eventId?: string | null; now?: number } = {},
): Promise<boolean> {
  try {
    const now = opts.now ?? Date.now();
    await db.analytics.add({
      channel,
      clientId: uuidv7(now),
      eventId: opts.eventId ?? null,
      at: now,
      event,
    });
    const over = (await db.analytics.count()) - OUTBOX_MAX;
    if (over > 0) {
      const oldest = await db.analytics.orderBy('seq').limit(over).primaryKeys();
      await db.analytics.bulkDelete(oldest);
    }
    return true;
  } catch {
    return false;
  }
}

/** Drop events nobody will ever accept: older than a week. */
export async function pruneAnalytics(db: BoothDB, now = Date.now()): Promise<void> {
  try {
    await db.analytics
      .where('at')
      .below(now - OUTBOX_MAX_AGE_MS)
      .delete();
  } catch {
    // Nothing to prune with, nothing lost that mattered.
  }
}

/** How a send went; the caller maps HTTP statuses onto these. */
export type SendResult =
  /** Accepted. Individual events the server refused are refused for good, so they go too. */
  | { kind: 'ok' }
  /** The batch itself was refused as malformed: it will never be accepted. */
  | { kind: 'rejected' }
  | { kind: 'too_large' }
  /** The credentials are no longer valid (the device was revoked, the display removed). */
  | { kind: 'unauthorized' }
  /** Network down, throttled or the server unwell: try again later. */
  | { kind: 'retry' };

export type FlushStep = 'empty' | 'sent' | 'dropped' | 'retry' | 'unauthorized';

/**
 * Send the oldest events of a channel as one batch. Call again while it answers `sent` or
 * `dropped`; stop on `empty`, and wait (with backoff) on `retry`. `unauthorized` keeps the events:
 * a display that is paired again, or a device that is restored, can still deliver them.
 */
export async function flushAnalytics(
  db: BoothDB,
  channel: AnalyticsChannel,
  send: (batch: IngestBatch) => Promise<SendResult>,
  opts: { now?: () => number; limit?: number } = {},
): Promise<FlushStep> {
  const now = opts.now ?? Date.now;
  let limit = Math.min(INGEST_MAX_EVENTS, opts.limit ?? INGEST_MAX_EVENTS);
  for (;;) {
    let rows: LocalAnalyticsEvent[];
    try {
      await pruneAnalytics(db, now());
      rows = await db.analytics.where('channel').equals(channel).limit(limit).toArray();
    } catch {
      return 'retry';
    }
    if (rows.length === 0) return 'empty';
    const batch: IngestBatch = {
      sentAt: now(),
      events: rows.map((r) => ({ id: r.clientId, at: r.at, eventId: r.eventId, event: r.event })),
    };
    let result: SendResult;
    try {
      result = await send(batch);
    } catch {
      return 'retry';
    }
    if (result.kind === 'unauthorized') return 'unauthorized';
    if (result.kind === 'retry') return 'retry';
    // Smaller batches; a single event that is too large is not going to fit, ever.
    if (result.kind === 'too_large' && rows.length > 1) {
      limit = Math.max(1, Math.floor(rows.length / 2));
      continue;
    }
    // Accepted, refused for good, or one oversized event: either way these rows have nothing more to do.
    try {
      await db.analytics.bulkDelete(rows.map((r) => r.seq!));
    } catch {
      return 'retry';
    }
    return result.kind === 'ok' ? 'sent' : 'dropped';
  }
}
