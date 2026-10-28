import { NextResponse } from 'next/server';
import { renderPathRequestSchema } from '@immersia/shared';
import { authenticateDevice } from '@/server/devices';
import { allow } from '@/server/rate-limit';
import { recordRenderPath } from '@/server/render-path';

/**
 * A booth reports the rung of the render ladder that worked (`local`, `wasm` or `server`), for the device's
 * record. Best effort on the booth's side: it never stands between a guest and their video.
 */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  const parsed = renderPathRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  // Over the cap: drop it (a 204 keeps the booth's queue moving; nothing is lost that matters).
  if (!(await allow('renderPathPerDevice', device.id))) return new NextResponse(null, { status: 204 });
  await recordRenderPath(device, parsed.data.path);
  return NextResponse.json({ ok: true });
}
