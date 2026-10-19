import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { isLinkId } from '@immersia/shared';
import { env } from '@/server/env';

/**
 * E2E only (acceptance #8, "clock → 410"): move a session's expiry into the past, as if its event's
 * retention had run out. Disabled unless E2E=1, which env() refuses on any Vercel deployment.
 */
export async function POST(request: Request) {
  if (env().E2E !== '1') return new NextResponse(null, { status: 404 });
  const linkId = new URL(request.url).searchParams.get('linkId') ?? '';
  if (!isLinkId(linkId)) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const rows = await db()
    .update(schema.captureSession)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(schema.captureSession.linkId, linkId))
    .returning({ id: schema.captureSession.id });
  return NextResponse.json({ updated: rows.length });
}
