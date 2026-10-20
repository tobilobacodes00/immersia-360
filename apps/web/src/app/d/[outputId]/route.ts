import { NextResponse } from 'next/server';
import { isLinkId } from '@immersia/shared';
import { track } from '@/server/analytics';
import { allow, clientIp } from '@/server/rate-limit';
import { downloadUrl } from '@/server/share';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DL-8 download: checks the session's link id (the access secret), counts the download and
 * redirects to a short-lived signed URL that saves under the event's filename. An expired session
 * answers 410 Gone (DL-9).
 */
export async function GET(request: Request, { params }: { params: Promise<{ outputId: string }> }) {
  const { outputId } = await params;
  const url = new URL(request.url);
  const linkId = url.searchParams.get('l') ?? '';
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
  if (!UUID.test(outputId) || !isLinkId(linkId)) return new NextResponse('Not found', { status: 404, headers });
  if (!(await allow('downloadPerIp', await clientIp())))
    return new NextResponse('Too many requests', { status: 429, headers: { ...headers, 'retry-after': '60' } });

  const result = await downloadUrl(linkId, outputId);
  if ('error' in result) {
    if (result.error === 'expired') return new NextResponse('This event has ended', { status: 410, headers });
    if (result.error === 'erased') return new NextResponse('Deleted at the guest’s request', { status: 410, headers });
    if (result.error === 'not_ready') return NextResponse.redirect(new URL(`/s/${linkId}`, url), 303);
    return new NextResponse('Not found', { status: 404, headers });
  }
  track({ name: 'file_downloaded', output_kind: result.kind, bytes: result.bytes ?? 0 }, { eventId: result.eventId });
  return NextResponse.redirect(result.url, { status: 302, headers });
}
