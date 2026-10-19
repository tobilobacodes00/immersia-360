import { NextResponse } from 'next/server';
import { env } from '@/server/env';
import { expireSessions } from '@/server/share';

/**
 * DL-9 expiry sweep, run hourly by Vercel Cron (vercel.json). Vercel sends CRON_SECRET as a bearer
 * token; anything else is refused, so the sweep can't be triggered from outside.
 */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await expireSessions();
  return NextResponse.json(result);
}
