import { NextResponse } from 'next/server';
import { purgeAssets } from '@/server/assets';
import { enqueueMissingCopies, processCloudCopies } from '@/server/cloud/copy';
import { verifyConnections } from '@/server/cloud/integrations';
import { env } from '@/server/env';
import { expireSessions } from '@/server/share';

// Copies stream large files: give the sweep the longest run the platform allows.
export const maxDuration = 300;

/**
 * DL-9 expiry sweep, run hourly by Vercel Cron (vercel.json), plus the asset library's cleanup of
 * abandoned uploads and deleted assets. Vercel sends CRON_SECRET as a bearer token; anything else
 * is refused, so the sweep can't be triggered from outside.
 *
 * It also drives the cloud copy queue (SHR-7): queues anything the upload hook missed, then copies
 * due files (the retries that back off over minutes and hours happen here), and notices
 * connections the operator has revoked.
 */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // Copies first: an expiring session's files should leave for the operator's cloud before they go.
  const queued = await enqueueMissingCopies().catch(failure('queue'));
  const copies = await processCloudCopies(50, 150_000).catch(failure('copy'));
  const connections = await verifyConnections().catch(failure('verify'));
  const result = await expireSessions();
  const assets = await purgeAssets();
  return NextResponse.json({ ...result, assets, cloud: { queued, copies, connections } });
}

/** A broken cloud queue must not stop the expiry sweep: report it and carry on. */
const failure = (stage: string) => (err: unknown) => {
  console.error('[cron] cloud copies', stage, err instanceof Error ? err.name : err);
  return { error: stage };
};
