import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { galleryCookie, galleryEvent, validGalleryPass, zipFiles } from '@/server/gallery';

/** SHR-5 bulk download: the gallery's full-quality files, a page at a time, as signed links. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ev = await galleryEvent(slug);
  if (!ev) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (ev.passwordHash && !validGalleryPass(slug, ev.passwordHash, (await cookies()).get(galleryCookie(slug))?.value))
    return NextResponse.json({ error: 'locked' }, { status: 401 });
  const cursor = new URL(request.url).searchParams.get('cursor');
  return NextResponse.json(await zipFiles(ev.id, { everything: false, cursor }), {
    headers: { 'cache-control': 'no-store' },
  });
}
