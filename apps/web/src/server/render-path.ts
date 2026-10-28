import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import type { RenderPath } from '@immersia/shared';
import type { DeviceRow } from './devices';

const { device } = schema;

/**
 * A booth reports which rung of the render ladder produced its last video. It becomes the device's
 * `capabilities.renderPath` (what the Devices screen shows: renders on device, on device slower, in the
 * cloud), replacing the label the device registered with. How long renders took, and how they ended, are
 * analytics events the booth sends through its own outbox; this is only the device's record.
 */
export async function recordRenderPath(row: DeviceRow, path: RenderPath): Promise<void> {
  if (row.capabilities.renderPath === path) return;
  await db()
    .update(device)
    .set({ capabilities: sql`jsonb_set(${device.capabilities}, '{renderPath}', to_jsonb(${path}::text))` })
    .where(eq(device.id, row.id));
}
