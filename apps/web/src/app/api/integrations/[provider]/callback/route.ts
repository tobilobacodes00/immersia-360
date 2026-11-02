import { NextResponse, after } from 'next/server';
import { roleCan } from '@/lib/permissions';
import { enqueueMissingCopies, processCloudCopies } from '@/server/cloud/copy';
import { completeConnect } from '@/server/cloud/integrations';
import { isCloudProvider } from '@/server/cloud/providers';
import { appOrigin } from '@/server/env';
import { getOperator } from '@/server/session';

// Work scheduled with after() copies files already waiting for this cloud.
export const maxDuration = 300;

const to = (path: string) =>
  NextResponse.redirect(new URL(path, appOrigin()), { status: 302, headers: { 'cache-control': 'no-store' } });

/**
 * SHR-7: where Google Drive / Dropbox send the operator back. The code is exchanged only with a
 * genuine, unexpired state that names this signed-in operator, their organization and this
 * provider (so a link someone else crafted can't attach their cloud account to this organization).
 * The refresh token is stored encrypted; the operator lands on the Integrations screen either way,
 * with `connected` or an `error` code that screen explains.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isCloudProvider(provider)) return new NextResponse(null, { status: 404 });
  const op = await getOperator();
  if (!op) return to('/sign-in?next=%2Fstudio%2Fintegrations');
  const fail = (code: string) => to(`/studio/integrations?error=${code}&provider=${provider}`);
  if (!roleCan(op.role, { integration: ['connect'] })) return fail('forbidden');

  const query = new URL(request.url).searchParams;
  // The operator pressed "Cancel" on the consent screen.
  if (query.get('error')) return fail('denied');
  const code = query.get('code');
  const state = query.get('state');
  if (!code || !state) return fail('state');

  try {
    const result = await completeConnect(op, provider, { code, state });
    if (!result.ok) return fail(result.error);
  } catch (err) {
    console.error('[integrations] connect failed', err instanceof Error ? err.name : err);
    return fail('failed');
  }
  // Reconnecting resumes everything that waited: queue what was missed, then start copying.
  after(() =>
    enqueueMissingCopies({ organizationId: op.organizationId, provider })
      .then(() => processCloudCopies(5))
      .catch((err: unknown) => console.error('[cloud-copy] could not resume', err instanceof Error ? err.name : err)),
  );
  return to(`/studio/integrations?connected=${provider}`);
}
