import { NextResponse } from 'next/server';
import { workerCompleteRequestSchema } from '@immersia/shared';
import { isUuid, withStorage } from '@/server/render-http';
import { completeJob, isRenderWorker } from '@/server/render-jobs';

// Publishing the outputs starts the follow-ups (Live Display, cloud copies) after the response.
export const maxDuration = 300;

/**
 * The worker has uploaded everything: the server checks the files are in storage at their declared
 * size, publishes them to the session exactly like a booth's uploads, and finishes the job.
 * 409 `incomplete`: something is missing (the worker uploads again); `lease_lost`: not its job any more.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isRenderWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const parsed = workerCompleteRequestSchema.safeParse(await request.json().catch(() => null));
  if (!isUuid(id) || !parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  return withStorage(async () => {
    const result = await completeJob(id, parsed.data.claimToken, parsed.data.renderMs);
    return result === 'ok' ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result }, { status: 409 });
  });
}
