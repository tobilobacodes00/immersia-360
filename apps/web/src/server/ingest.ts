import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import {
  DEVICE_AUTH_SCHEME,
  analyticsEventSchema,
  canEmit,
  resolveOccurredAt,
  type AnalyticsEvent,
  type ClientSource,
  type IngestBatch,
} from '@immersia/shared';
import { insertRows, toRow, type AnalyticsRow } from './analytics';
import { authenticateDevice } from './devices';
import { appOrigin } from './env';
import { displayByToken } from './live';
import { getOperator } from './session';

/**
 * Client analytics ingestion (POST /api/t). A booth authenticates with its device token, a Live
 * Display with its display token, the studio with the operator's session. Each source may report
 * only the events it has a reason to know (EVENT_SOURCES), every event is validated on its own, and
 * its time is the server's best reconstruction of when it happened, not the device's word.
 */

export interface IngestActor {
  source: ClientSource;
  organizationId: string;
  deviceId: string | null;
  /** A display reports for exactly the event it is paired to, whatever it claims. */
  displayEventId: string | null;
  /** The rate-limit key: one booth, display or operator. */
  limitKey: string;
}

/** A cookie-authenticated request must come from our own pages, as JSON (not a cross-site form post). */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  return origin !== null && (origin === new URL(request.url).origin || origin === appOrigin());
}

export async function authenticateIngest(request: Request): Promise<IngestActor | null> {
  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith(`${DEVICE_AUTH_SCHEME} `)) {
    const device = await authenticateDevice(request);
    return device
      ? {
          source: 'device',
          organizationId: device.organizationId,
          deviceId: device.id,
          displayEventId: null,
          limitKey: `device:${device.id}`,
        }
      : null;
  }
  if (/^Bearer /i.test(header)) {
    const display = await displayByToken(header.replace(/^Bearer\s+/i, ''));
    if (!display) return null;
    const [ev] = await db()
      .select({ organizationId: schema.event.organizationId })
      .from(schema.event)
      .where(eq(schema.event.id, display.eventId))
      .limit(1);
    return ev
      ? {
          source: 'display',
          organizationId: ev.organizationId,
          deviceId: null,
          displayEventId: display.eventId,
          limitKey: `display:${display.id}`,
        }
      : null;
  }
  if (!sameOrigin(request)) return null;
  const op = await getOperator();
  return op
    ? {
        source: 'studio',
        organizationId: op.organizationId,
        deviceId: null,
        displayEventId: null,
        limitKey: `studio:${op.userId}`,
      }
    : null;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejected: { index: number; reason: 'invalid' | 'not_allowed' }[];
}

export async function ingestBatch(actor: IngestActor, batch: IngestBatch, now = Date.now()): Promise<IngestResult> {
  const rejected: IngestResult['rejected'] = [];
  const staged: { event: AnalyticsEvent; at: number; clientId: string; eventId: string | null }[] = [];
  batch.events.forEach((item, index) => {
    const parsed = analyticsEventSchema.safeParse(item.event);
    if (!parsed.success) return void rejected.push({ index, reason: 'invalid' });
    const event = parsed.data;
    // A booth uploads to our own storage; Drive and Dropbox copies are made, and reported, by the server.
    const allowed =
      canEmit(actor.source, event.name) && !(event.name === 'upload_completed' && event.target !== 'hosted');
    if (!allowed) return void rejected.push({ index, reason: 'not_allowed' });
    staged.push({ event, at: item.at, clientId: item.id, eventId: actor.displayEventId ?? item.eventId ?? null });
  });

  // An event id from a device only counts when it is the organization's own.
  const claimed = [...new Set(staged.flatMap((s) => (s.eventId ? [s.eventId] : [])))];
  const owned = new Set<string>();
  if (claimed.length && !actor.displayEventId) {
    const rows = await db()
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(and(inArray(schema.event.id, claimed), eq(schema.event.organizationId, actor.organizationId)));
    for (const r of rows) owned.add(r.id);
  }

  const rows = staged.flatMap((s): AnalyticsRow[] => {
    const eventId = actor.displayEventId ?? (s.eventId && owned.has(s.eventId) ? s.eventId : null);
    const row = toRow(
      s.event,
      { organizationId: actor.organizationId, eventId, deviceId: actor.deviceId },
      {
        source: actor.source,
        clientId: s.clientId,
        occurredAt: new Date(resolveOccurredAt({ at: s.at, sentAt: batch.sentAt, now }).ms),
      },
    );
    return row ? [row] : [];
  });
  const { stored, duplicates } = await insertRows(rows);
  return { accepted: stored, duplicates, rejected };
}
