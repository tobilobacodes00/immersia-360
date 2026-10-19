import { NextResponse } from 'next/server';
import { isLinkId } from '@immersia/shared';
import { sessionState } from '@/server/share-state';

/** What the "on their way" poller needs: how many of the session's files are ready. */
export async function GET(_request: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
  if (!isLinkId(linkId)) return NextResponse.json({ error: 'not_found' }, { status: 404, headers });
  const state = await sessionState(linkId);
  // Not registered yet is a normal state (the booth is offline or still queueing), not an error.
  return NextResponse.json(state ?? { state: 'pending', ready: 0, total: 0 }, { headers });
}
