import { NextResponse } from 'next/server';
import { resolveMedia } from '@/server/live';

/**
 * A screen's media link: signed, so screens need no login; checked on every request, so hiding an
 * item (or the guest opting out) stops it loading anywhere at once.
 */
export async function GET(request: Request, { params }: { params: Promise<{ outputId: string }> }) {
  const { outputId } = await params;
  const url = new URL(request.url);
  if (!/^[0-9a-f-]{36}$/i.test(outputId)) return new NextResponse(null, { status: 404 });
  const target = await resolveMedia(outputId, Number(url.searchParams.get('e')), url.searchParams.get('s') ?? '');
  if (!target) return new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  return NextResponse.redirect(target, { status: 302, headers: { 'cache-control': 'private, max-age=240' } });
}
