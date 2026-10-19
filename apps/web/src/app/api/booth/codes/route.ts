import { NextResponse } from 'next/server';
import { reserveCodesSchema } from '@immersia/shared';
import { authenticateDevice } from '@/server/devices';
import { reserveCodes } from '@/server/sessions';

/** DL-2: top up this device's pool of short codes for an event (used offline). */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  const parsed = reserveCodesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const codes = await reserveCodes(device, parsed.data.eventId, parsed.data.count);
  if (!codes) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ codes });
}
