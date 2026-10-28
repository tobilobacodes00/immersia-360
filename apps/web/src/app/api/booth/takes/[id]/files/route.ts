import { NextResponse } from 'next/server';
import { serverFilesRequestSchema } from '@immersia/shared';
import { authenticateDevice } from '@/server/devices';
import { allow } from '@/server/rate-limit';
import { isUuid, refusal, withStorage } from '@/server/render-http';
import { requestFiles } from '@/server/render-jobs';

/**
 * Upload URLs for the files a server render needs (the take's original, the overlay and end card the
 * booth drew). Device-authenticated; the keys are derived on the server, never taken from the booth.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  const { id } = await params;
  const parsed = serverFilesRequestSchema.safeParse(await request.json().catch(() => null));
  if (!isUuid(id) || !parsed.success) return refusal({ error: 'invalid' });
  if (!(await allow('serverFilesPerDevice', device.id)))
    return NextResponse.json({ error: 'device_rate_limited' }, { status: 429, headers: { 'retry-after': '60' } });
  return withStorage(async () => {
    const res = await requestFiles(device, id, parsed.data);
    return 'error' in res ? refusal(res) : NextResponse.json(res);
  });
}
