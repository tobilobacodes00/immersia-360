import { NextResponse } from 'next/server';
import { deviceStatusSchema } from '@immersia/shared';
import { authenticateDevice, recordHeartbeat } from '@/server/devices';

/**
 * Booth heartbeat (every ~30 s while a booth screen is open): marks the device as seen and reports
 * its render/upload queue for the event dashboard (EVT-3). 401 tells the booth it was revoked.
 */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  const parsed = deviceStatusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  await recordHeartbeat(device.id, parsed.data);
  return NextResponse.json({ ok: true, deviceId: device.id, name: device.name });
}
