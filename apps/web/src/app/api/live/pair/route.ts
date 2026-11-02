import { NextResponse } from 'next/server';
import { z } from 'zod';
import { claimPairing } from '@/server/live';
import { allow, clientIp } from '@/server/rate-limit';

const body = z.object({ code: z.string().trim().min(4).max(12) });

/** LIV-1: a TV turns a pairing code into its display token. No login on the TV. */
export async function POST(request: Request) {
  if (!(await allow('displayPairPerIp', await clientIp())))
    return NextResponse.json({ error: 'too_many' }, { status: 429 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const result = await claimPairing(parsed.data.code);
  if (result === 'invalid' || result === 'expired') return NextResponse.json({ error: result }, { status: 404 });
  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
}
