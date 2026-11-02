import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  GALLERY_PASS_MAX_AGE_S,
  galleryCookie,
  galleryEvent,
  galleryPass,
  verifyGalleryPassword,
} from '@/server/gallery';
import { allow, clientIp } from '@/server/rate-limit';

const body = z.object({ password: z.string().min(1).max(200) });

/** SHR-5: the client's password opens the gallery for a week on this browser. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await allow('galleryUnlockPerIp', `${await clientIp()}:${slug}`)))
    return NextResponse.json({ error: 'too_many' }, { status: 429 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  const ev = await galleryEvent(slug);
  if (!ev) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ev.passwordHash) return NextResponse.json({ ok: true });
  if (!parsed.success || !verifyGalleryPassword(parsed.data.password, ev.passwordHash))
    return NextResponse.json({ error: 'wrong_password' }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(galleryCookie(slug), galleryPass(slug, ev.passwordHash), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/`,
    maxAge: GALLERY_PASS_MAX_AGE_S,
  });
  return res;
}
