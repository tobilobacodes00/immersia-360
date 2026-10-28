import { NextResponse } from 'next/server';
import { serverRenderRequestSchema } from '@immersia/shared';
import { authenticateDevice } from '@/server/devices';
import { allow } from '@/server/rate-limit';
import { isUuid, refusal, withStorage } from '@/server/render-http';
import { jobForTake, requestRender } from '@/server/render-jobs';

// Waking the render worker runs after the response, inside this function's time limit.
export const maxDuration = 30;

/**
 * Queue a server render of a take whose files the booth has uploaded (the `server` rung of the render
 * ladder). The recipe is validated against the same zod schema the booth builds it from; limits per
 * event and organization apply (a clear 429 the booth shows). Idempotent per take.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  const { id } = await params;
  const parsed = serverRenderRequestSchema.safeParse(await request.json().catch(() => null));
  if (!isUuid(id) || !parsed.success) return refusal({ error: 'invalid' });
  if (!(await allow('serverRenderPerDevice', device.id)))
    return NextResponse.json({ error: 'device_rate_limited' }, { status: 429, headers: { 'retry-after': '60' } });
  return withStorage(async () => {
    const res = await requestRender(device, id, parsed.data);
    return 'error' in res ? refusal(res) : NextResponse.json(res);
  });
}

/** The take's latest server render: the booth polls it to learn when its video is done (or failed). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return refusal({ error: 'invalid' });
  return NextResponse.json({ job: await jobForTake(device, id) }, { headers: { 'cache-control': 'no-store' } });
}
