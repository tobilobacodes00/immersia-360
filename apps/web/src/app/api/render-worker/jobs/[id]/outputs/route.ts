import { NextResponse } from 'next/server';
import { workerOutputsRequestSchema } from '@immersia/shared';
import { isUuid, withStorage } from '@/server/render-http';
import { isRenderWorker, registerOutputs } from '@/server/render-jobs';

/**
 * The worker has rendered: register the outputs it will upload (video, poster, messaging copy) and
 * get an upload URL for each, signed for the exact size and type.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isRenderWorker(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const parsed = workerOutputsRequestSchema.safeParse(await request.json().catch(() => null));
  if (!isUuid(id) || !parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  return withStorage(async () => {
    const res = await registerOutputs(id, parsed.data);
    return 'error' in res ? NextResponse.json(res, { status: 409 }) : NextResponse.json(res);
  });
}
