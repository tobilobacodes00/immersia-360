import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateDevice } from '@/server/devices';
import { allow } from '@/server/rate-limit';
import { qrScanned, startQr } from '@/server/setup-check';
import { isNonce } from '@/server/setup-check-token';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('poll'), nonce: z.string().refine(isNonce) }),
]);

/**
 * HLP-1 test QR. `start` makes a short-lived signed token for this device (the booth puts it in a
 * QR); `poll` says whether a phone has opened it yet. POST for both, so no cache ever answers a poll.
 */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  if (parsed.data.action === 'start') {
    if (!(await allow('setupCheckPerDevice', device.id)))
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    const { token, nonce, expiresAt } = startQr(device.id);
    return NextResponse.json({ token, nonce, expiresAt });
  }
  if (!(await allow('setupCheckPollPerDevice', device.id)))
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  return NextResponse.json({ scanned: await qrScanned(device.id, parsed.data.nonce) });
}
