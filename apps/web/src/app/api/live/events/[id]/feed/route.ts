import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { roleCan } from '@/lib/permissions';
import { appOrigin } from '@/server/env';
import { eventFeed } from '@/server/live';
import { getOperator } from '@/server/session';

/** The event's feed for a signed-in operator device: the Sharing Station (SHR-4) and the control page. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const op = await getOperator();
  if (!op || !roleCan(op.role, { event: ['read'] }))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const role = new URL(request.url).searchParams.get('role') === 'operator' ? 'operator' : 'station';
  const feed = await eventFeed(op.organizationId, id, appOrigin(), role, op.userId);
  if (!feed) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const etag = `"${createHash('sha1')
    .update(JSON.stringify([feed.config, feed.items]))
    .digest('base64url')}"`;
  const headers = { etag, 'cache-control': 'no-store' };
  if (request.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers });
  return NextResponse.json(feed, { headers });
}
