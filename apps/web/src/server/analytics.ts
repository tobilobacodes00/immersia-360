import 'server-only';
import { after } from 'next/server';
import { db, schema } from '@immersia/db';
import type { AnalyticsEvent } from '@immersia/shared';

/**
 * First-party analytics (PRD "Tracked events"): one row per event, no third-party scripts, nothing
 * that identifies a guest. Recorded after the response is sent, so a slow insert never delays a
 * guest's page or download; a failed insert is logged, not surfaced.
 */
export function track(
  event: AnalyticsEvent,
  scope: { organizationId?: string | null; eventId?: string | null; deviceId?: string | null } = {},
) {
  const { name, ...props } = event;
  after(async () => {
    try {
      await db()
        .insert(schema.analyticsEvent)
        .values({
          name,
          props,
          organizationId: scope.organizationId ?? null,
          eventId: scope.eventId ?? null,
          deviceId: scope.deviceId ?? null,
          occurredAt: new Date(),
        });
    } catch (err) {
      console.error('[analytics] insert failed', name, err);
    }
  });
}
