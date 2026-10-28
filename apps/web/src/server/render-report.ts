import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import type { RenderReportRequest } from '@immersia/shared';
import { track } from './analytics';
import type { DeviceRow } from './devices';

const { device, event } = schema;

/**
 * A booth reports how a render went: the first-party `render_completed` / `render_failed` events
 * (PRD "Tracked events"), and the rung of the render ladder that worked, which becomes the device's
 * `capabilities.renderPath` (what the devices screen shows, and what a re-registered booth starts from).
 */
export async function recordRenderReport(row: DeviceRow, input: RenderReportRequest): Promise<void> {
  // The event id comes from the client: it counts only when it is the organization's own.
  let eventId: string | null = null;
  if (input.eventId) {
    const [ev] = await db()
      .select({ id: event.id })
      .from(event)
      .where(and(eq(event.id, input.eventId), eq(event.organizationId, row.organizationId)))
      .limit(1);
    eventId = ev?.id ?? null;
  }
  const scope = { organizationId: row.organizationId, eventId, deviceId: row.id };
  const r = input.report;
  if (r.outcome === 'completed')
    track(
      {
        name: 'render_completed',
        render_ms: r.renderMs,
        path: r.path,
        preset: r.preset,
        effects_count: r.effectsCount,
      },
      scope,
    );
  else track({ name: 'render_failed', error_code: r.errorCode, path: r.path, browser: r.browser }, scope);

  if (input.remember && row.capabilities.renderPath !== input.remember) {
    await db()
      .update(device)
      .set({ capabilities: sql`jsonb_set(${device.capabilities}, '{renderPath}', to_jsonb(${input.remember}::text))` })
      .where(eq(device.id, row.id));
  }
}
