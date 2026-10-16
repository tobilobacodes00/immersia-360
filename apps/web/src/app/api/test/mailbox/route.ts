import { NextResponse } from 'next/server';
import { devMailbox } from '@/server/dev-mailbox';
import { env } from '@/server/env';

/**
 * E2E only: the latest email sent to an address, so Playwright can follow a magic link. Disabled
 * unless E2E=1, and env() refuses E2E=1 on any Vercel deployment.
 */
export async function GET(request: Request) {
  if (env().E2E !== '1') return new NextResponse(null, { status: 404 });
  const to = new URL(request.url).searchParams.get('to');
  if (!to) return NextResponse.json({ error: 'missing to' }, { status: 400 });
  const mail = devMailbox.latestFor(to);
  if (!mail) return NextResponse.json({ error: 'no mail' }, { status: 404 });
  return NextResponse.json(mail);
}
