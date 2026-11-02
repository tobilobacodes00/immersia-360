import { NextResponse } from 'next/server';
import { authenticateDevice } from '@/server/devices';
import { withdrawHighlightsWith } from '@/server/highlights';
import { optOutOfDisplay } from '@/server/live';

/**
 * LIV-8: the guest chose "don't show on screen" on the result screen, after the session registered. They are off
 * every screen at once, out of the client gallery, and out of any highlight reel that already holds their clip: the
 * reel is deleted (the hourly sweep would find it too, so a failure here only delays that).
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const ok = await optOutOfDisplay(device.organizationId, id);
  if (ok)
    await withdrawHighlightsWith(id).catch((err: unknown) =>
      console.error(
        '[opt-out] highlight reel withdrawal failed, the sweep will retry',
        err instanceof Error ? err.name : err,
      ),
    );
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
