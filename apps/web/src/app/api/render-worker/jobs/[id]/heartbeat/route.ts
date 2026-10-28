import { NextResponse } from 'next/server';
import { workerTokenSchema } from '@immersia/shared';
import { isUuid } from '@/server/render-http';
import { heartbeat, isRenderWorker } from '@/server/render-jobs';

/** The worker is still rendering: extend its lease. 409 tells it the job is no longer its own. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isRenderWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const parsed = workerTokenSchema.safeParse(await request.json().catch(() => null));
  if (!isUuid(id) || !parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const result = await heartbeat(id, parsed.data.claimToken);
  return result === 'ok' ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result }, { status: 409 });
}
