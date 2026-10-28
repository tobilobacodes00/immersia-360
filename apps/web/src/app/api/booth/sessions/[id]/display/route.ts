import { NextResponse } from 'next/server';
import { authenticateDevice } from '@/server/devices';
import { optOutOfDisplay } from '@/server/live';

/** LIV-8: the guest chose "don't show on screen" on the result screen, after the session registered. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const ok = await optOutOfDisplay(device.organizationId, id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
