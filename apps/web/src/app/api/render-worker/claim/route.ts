import { NextResponse } from 'next/server';
import { workerClaimRequestSchema } from '@immersia/shared';
import { withStorage } from '@/server/render-http';
import { claimJob, isRenderWorker } from '@/server/render-jobs';

// A job that ran out of tries is reported (analytics) after the response.
export const maxDuration = 30;

/**
 * The render worker asks for work: the oldest due job, with the recipe and short-lived download
 * links for its files, or `{ job: null }`. Worker-only: the shared RENDER_WORKER_SECRET as a bearer
 * token (a deployment without the secret has no server rung and refuses everyone).
 */
export async function POST(request: Request) {
  if (!isRenderWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = workerClaimRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  return withStorage(async () =>
    NextResponse.json(await claimJob(parsed.data.workerId), { headers: { 'cache-control': 'no-store' } }),
  );
}
