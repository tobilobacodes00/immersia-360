import { NextResponse } from 'next/server';
import { appOrigin } from '@/server/env';
import { displayByToken, displayFeed, feedEtag } from '@/server/live';

/**
 * A paired display's feed (screen 17): its configuration and the items on screen. Polled every few
 * seconds when the hub is unreachable, so an unchanged feed is a cheap 304.
 */
export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const d = await displayByToken(token);
  if (!d) return NextResponse.json({ error: 'unpaired' }, { status: 401 });
  const feed = await displayFeed(d, appOrigin());
  if (!feed) return NextResponse.json({ error: 'unpaired' }, { status: 401 });
  const etag = feedEtag(feed);
  const headers = { etag, 'cache-control': 'no-store' };
  if (request.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers });
  return NextResponse.json(feed, { headers });
}
