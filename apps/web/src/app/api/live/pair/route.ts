import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseScreenSize } from '@immersia/shared';
import { track } from '@/server/analytics';
import { claimPairing } from '@/server/live';
import { allow, clientIp } from '@/server/rate-limit';

const body = z.object({
  code: z.string().trim().min(4).max(12),
  /** `screen.width x screen.height` of the TV, for the paired-display analytics. */
  screen: z.string().max(12).optional(),
});

/** LIV-1: a TV turns a pairing code into its display token. No login on the TV. */
export async function POST(request: Request) {
  if (!(await allow('displayPairPerIp', await clientIp())))
    return NextResponse.json({ error: 'too_many' }, { status: 429 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const result = await claimPairing(parsed.data.code);
  if (result === 'invalid' || result === 'expired') return NextResponse.json({ error: result }, { status: 404 });
  // A new display is born on the default layout; the operator switches it afterwards (LIV-3).
  track(
    { name: 'display_paired', layout: 'spotlight', screen_size: parseScreenSize(parsed.data.screen) ?? 'unknown' },
    { eventId: result.eventId },
  );
  return NextResponse.json(
    { token: result.token, displayId: result.displayId },
    { headers: { 'cache-control': 'no-store' } },
  );
}
