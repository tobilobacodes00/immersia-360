import { NextResponse } from 'next/server';
import { renderReportRequestSchema } from '@immersia/shared';
import { authenticateDevice } from '@/server/devices';
import { allow } from '@/server/rate-limit';
import { recordRenderReport } from '@/server/render-report';

/**
 * A booth reports how a render went (`render_completed` / `render_failed` analytics) and which rung of
 * the render ladder worked, for the device's record. Best effort on the booth's side: it is never what
 * stands between a guest and their video.
 */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  const parsed = renderReportRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  // Over the cap: drop the report (a 204 keeps the booth's queue moving; nothing is lost that matters).
  if (!(await allow('renderReportPerDevice', device.id))) return new NextResponse(null, { status: 204 });
  await recordRenderReport(device, parsed.data);
  return NextResponse.json({ ok: true });
}
