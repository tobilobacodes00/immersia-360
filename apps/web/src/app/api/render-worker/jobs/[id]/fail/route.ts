import { NextResponse } from 'next/server';
import { workerFailRequestSchema } from '@immersia/shared';
import { isUuid } from '@/server/render-http';
import { failJob, isRenderWorker } from '@/server/render-jobs';

/**
 * A try failed, with a stable code. The server decides: back in the queue after a backoff, or failed
 * for good (the code is permanent, or the tries ran out).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isRenderWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const parsed = workerFailRequestSchema.safeParse(await request.json().catch(() => null));
  if (!isUuid(id) || !parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const held = await failJob(id, parsed.data.claimToken, parsed.data.code);
  return held ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'lease_lost' }, { status: 409 });
}
