import { NextResponse } from 'next/server';
import { roleCan } from '@/lib/permissions';
import { beginConnect } from '@/server/cloud/integrations';
import { isCloudProvider } from '@/server/cloud/providers';
import { appOrigin } from '@/server/env';
import { getOperator } from '@/server/session';

const to = (path: string) =>
  NextResponse.redirect(new URL(path, appOrigin()), { status: 302, headers: { 'cache-control': 'no-store' } });

/**
 * SHR-7: start connecting the organization's Google Drive or Dropbox. Only an operator allowed to
 * connect integrations (the owner) is sent on to the provider's consent screen; the OAuth state they
 * carry is signed and names them, their organization and the provider.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isCloudProvider(provider)) return new NextResponse(null, { status: 404 });
  const op = await getOperator();
  if (!op) return to('/sign-in?next=%2Fstudio%2Fintegrations');
  if (!roleCan(op.role, { integration: ['connect'] }))
    return to(`/studio/integrations?error=forbidden&provider=${provider}`);
  const url = beginConnect(op, provider);
  if (!url) return to(`/studio/integrations?error=unavailable&provider=${provider}`);
  return NextResponse.redirect(url, { status: 302, headers: { 'cache-control': 'no-store' } });
}
