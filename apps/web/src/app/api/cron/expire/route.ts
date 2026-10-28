import { NextResponse } from 'next/server';
import { ensureAnalyticsPartitions } from '@/server/analytics-maintenance';
import { purgeAssets } from '@/server/assets';
import { enqueueMissingCopies, processCloudCopies } from '@/server/cloud/copy';
import { verifyConnections } from '@/server/cloud/integrations';
import { env } from '@/server/env';
import { purgeErasedSessions } from '@/server/erasure';
import { runOrganizationDeletions } from '@/server/privacy';
import { expireSessions } from '@/server/share';

// Copies stream large files: give the sweep the longest run the platform allows.
export const maxDuration = 300;

/**
 * The hourly sweep, run by Vercel Cron (vercel.json). Vercel sends CRON_SECRET as a bearer token;
 * anything else is refused, so the sweep can't be triggered from outside.
 *
 * Stages, in order:
 * 1. the cloud copy queue (SHR-7): queue anything the upload hook missed, copy the files that are
 *    due (the retries that back off over minutes and hours happen here), and notice connections the
 *    operator has revoked. First, so an expiring session's files leave for the operator's cloud
 *    before they go;
 * 2. the expiry sweep (DL-9) and the asset library's cleanup of abandoned uploads and deleted assets;
 * 3. privacy: finish what guest erasures (files a late upload left, then the rows) and organization
 *    deletions started;
 * 4. analytics: keep the monthly partitions created for the months ahead.
 *
 * Every stage is isolated: one that throws is logged and reported as `{ error }` under its name and
 * never stops the stages after it, because they have nothing to do with each other and all of them
 * are safe to repeat on the next run. `failed` lists the stages that did.
 */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const failed: string[] = [];
  const stage = async <T>(name: string, run: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await run();
    } catch (err) {
      console.error('[cron] sweep stage failed:', name, err instanceof Error ? err.name : err);
      failed.push(name);
      return { error: name };
    }
  };

  const queued = await stage('cloud-queue', () => enqueueMissingCopies());
  const copies = await stage('cloud-copy', () => processCloudCopies(50, 150_000));
  const connections = await stage('cloud-verify', () => verifyConnections());
  const expiry = await stage('expiry', () => expireSessions());
  const assets = await stage('assets', () => purgeAssets());
  const erased = await stage('erasure', () => purgeErasedSessions());
  const deletions = await stage('organization-deletion', () => runOrganizationDeletions(60_000));
  const partitions = await stage('analytics-partitions', () => ensureAnalyticsPartitions());

  return NextResponse.json({
    ok: failed.length === 0,
    failed,
    expiry,
    assets,
    erased,
    deletions,
    partitions,
    cloud: { queued, copies, connections },
  });
}
