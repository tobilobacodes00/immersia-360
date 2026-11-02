import { NextResponse } from 'next/server';
import { setupCheckReportSchema } from '@immersia/shared';
import { authenticateDevice } from '@/server/devices';
import { allow } from '@/server/rate-limit';
import { saveSetupCheck } from '@/server/setup-check';

/**
 * HLP-1: the booth device reports a finished setup check. It is stored on the device (render path,
 * measured render speed, camera) and recorded as `setup_check_completed`. 401 tells the booth that
 * the device was revoked.
 */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  if (!(await allow('setupCheckPerDevice', device.id)))
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const parsed = setupCheckReportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  await saveSetupCheck(device, parsed.data);
  return NextResponse.json({ ok: true });
}
