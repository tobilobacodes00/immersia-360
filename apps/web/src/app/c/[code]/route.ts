import { NextResponse } from 'next/server';
import { resolveCode } from '@/server/codes';

/**
 * A code in the URL (printed signage, the short domain's `/{code}`): straight to the files, or to
 * the code form with the reason. An expired session goes to its link, which answers 410 (DL-9).
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const result = await resolveCode(decodeURIComponent(code).slice(0, 32));
  const to = new URL('/c', request.url);
  if ('linkId' in result) return NextResponse.redirect(new URL(`/s/${result.linkId}?r=code`, request.url), 303);
  to.searchParams.set('e', result.error);
  to.searchParams.set('code', code);
  return NextResponse.redirect(to, 303);
}
