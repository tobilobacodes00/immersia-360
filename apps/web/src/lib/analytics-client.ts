import { boothDb, enqueueAnalytics, type AnalyticsChannel, type SendResult } from '@immersia/offline';
import { uuidv7, type EventFrom, type IngestBatch } from '@immersia/shared';

/**
 * Client-side analytics (PRD "Tracked events"). Booths and Live Displays write each event to the
 * device database and a flusher sends them to POST /api/t in batches, with backoff, whenever the
 * network allows; the studio posts its own events straight away. Nothing here ever throws or waits:
 * capture, rendering and uploads come first, and an event that cannot be recorded is simply lost.
 *
 *   emitDeviceEvent({ name: 'qr_shown', seconds_since_take: 3.2 }, eventId)   // a booth
 *   emitDisplayEvent({ name: 'item_displayed', seconds_on_screen: 8 }, eventId) // a Live Display
 *   emitStudioEvent({ name: 'setup_check_completed', … })                       // the operator's studio
 */

/** Fired on the window when an event was buffered, so the flusher can send soon (batched). */
export const ANALYTICS_WAKE = 'immersia:analytics';

function buffer(channel: AnalyticsChannel, event: { name: string } & Record<string, unknown>, eventId?: string | null) {
  void enqueueAnalytics(boothDb(), channel, event, { eventId })
    .then((stored) => {
      if (stored) window.dispatchEvent(new Event(ANALYTICS_WAKE));
    })
    .catch(() => undefined);
}

/** An event from a booth device: buffered offline, sent with the device token. */
export function emitDeviceEvent(event: EventFrom<'device'>, eventId?: string | null): void {
  buffer('device', event, eventId);
}

/** An event from a Live Display: buffered offline, sent with the display token. */
export function emitDisplayEvent(event: EventFrom<'display'>, eventId?: string | null): void {
  buffer('display', event, eventId);
}

/**
 * An event from the operator's studio (a signed-in browser, so the session cookie authenticates it).
 * Fire and forget: the studio is online by definition, and a missed readiness check is not worth a queue.
 */
export function emitStudioEvent(event: EventFrom<'studio'>, eventId?: string | null): void {
  const batch: IngestBatch = {
    sentAt: Date.now(),
    events: [{ id: uuidv7(), at: Date.now(), eventId: eventId ?? null, event }],
  };
  void fetch('/api/t', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(batch),
    keepalive: true,
  }).catch(() => undefined);
}

/** POST a batch with a channel's credentials; the HTTP status becomes what the outbox needs to know. */
export async function sendBatch(authorization: string, batch: IngestBatch, keepalive: boolean): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch('/api/t', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization },
      body: JSON.stringify(batch),
      keepalive,
    });
  } catch {
    return { kind: 'retry' };
  }
  if (res.ok) return { kind: 'ok' };
  if (res.status === 401) return { kind: 'unauthorized' };
  if (res.status === 413) return { kind: 'too_large' };
  if (res.status === 400) return { kind: 'rejected' };
  return { kind: 'retry' }; // 429, 5xx, anything unexpected
}
