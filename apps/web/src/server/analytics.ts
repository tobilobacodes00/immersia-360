import 'server-only';
import { after } from 'next/server';
import { and, gt, inArray } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { analyticsEventSchema, type AnalyticsEvent, type AnalyticsSource } from '@immersia/shared';

/**
 * First-party analytics (PRD "Tracked events"): one row per event, no third-party scripts, nothing
 * that identifies a guest. Every event is validated against the shared catalogue before it is
 * stored, whoever sends it. A failed insert is logged, never surfaced: analytics must not be able
 * to break a guest's page, a download or a booth's work.
 */

export interface TrackScope {
  organizationId?: string | null;
  eventId?: string | null;
  deviceId?: string | null;
}

export type AnalyticsRow = typeof schema.analyticsEvent.$inferInsert;

/** Validate an event and shape its row, or null (with a log line) when the catalogue refuses it. */
export function toRow(
  event: AnalyticsEvent,
  scope: TrackScope,
  meta: { source: AnalyticsSource; occurredAt?: Date; clientId?: string | null } = { source: 'server' },
): AnalyticsRow | null {
  const parsed = analyticsEventSchema.safeParse(event);
  if (!parsed.success) {
    console.error('[analytics] refused an invalid event', event?.name, parsed.error.issues[0]?.path.join('.'));
    return null;
  }
  const { name, ...props } = parsed.data;
  return {
    name,
    props,
    organizationId: scope.organizationId ?? null,
    eventId: scope.eventId ?? null,
    deviceId: scope.deviceId ?? null,
    clientId: meta.clientId ?? null,
    source: meta.source,
    occurredAt: meta.occurredAt ?? new Date(),
  };
}

/**
 * Store rows, skipping any whose client id was already stored in the last two days (a batch the
 * device sent again after a lost response). Within one call the first of two equal ids wins.
 * Returns how many were new.
 */
export async function insertRows(rows: AnalyticsRow[]): Promise<{ stored: number; duplicates: number }> {
  if (rows.length === 0) return { stored: 0, duplicates: 0 };
  const ids = [...new Set(rows.flatMap((r) => (r.clientId ? [r.clientId] : [])))];
  const known = new Set<string>();
  if (ids.length) {
    const found = await db()
      .select({ id: schema.analyticsEvent.clientId })
      .from(schema.analyticsEvent)
      .where(
        and(
          inArray(schema.analyticsEvent.clientId, ids),
          gt(schema.analyticsEvent.receivedAt, new Date(Date.now() - 2 * 86_400_000)),
        ),
      );
    for (const f of found) if (f.id) known.add(f.id);
  }
  const fresh = rows.filter((r) => {
    if (!r.clientId) return true;
    if (known.has(r.clientId)) return false;
    known.add(r.clientId);
    return true;
  });
  if (fresh.length) await db().insert(schema.analyticsEvent).values(fresh);
  return { stored: fresh.length, duplicates: rows.length - fresh.length };
}

/** Record one server-side event now. For code that already runs after the response (after(), cron). */
export async function recordNow(event: AnalyticsEvent, scope: TrackScope = {}): Promise<void> {
  try {
    const row = toRow(event, scope);
    if (row) await insertRows([row]);
  } catch (err) {
    console.error('[analytics] insert failed', event.name, err);
  }
}

/**
 * Record a server-side event after the response is sent, so a slow insert never delays a guest's
 * page or download.
 */
export function track(event: AnalyticsEvent, scope: TrackScope = {}): void {
  try {
    after(() => recordNow(event, scope));
  } catch {
    // Outside a request (a script, a test): record in the background rather than not at all.
    void recordNow(event, scope);
  }
}
