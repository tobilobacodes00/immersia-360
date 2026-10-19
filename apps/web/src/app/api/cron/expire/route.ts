import { NextResponse } from 'next/server';
import { purgeAssets } from '@/server/assets';
import { env } from '@/server/env';
import { expireSessions } from '@/server/share';

/**
 * DL-9 expiry sweep, run hourly by Vercel Cron (vercel.json), plus the asset library's cleanup of
 * abandoned uploads and deleted assets. Vercel sends CRON_SECRET as a bearer token; anything else
 * is refused, so the sweep can't be triggered from outside.
 */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await expireSessions();
  const assets = await purgeAssets();
  return NextResponse.json({ ...result, assets });
}
