import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateDevice } from '@/server/devices';
import { allow } from '@/server/rate-limit';
import { finishUploadTest, startUploadTest } from '@/server/setup-check';
import { StorageUnavailableError } from '@/server/storage';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('finish'), id: z.string().length(16) }),
]);

/**
 * HLP-1 network check, the same path a guest's file takes: `start` signs a small upload, the booth
 * PUTs it straight to storage, `finish` confirms it arrived whole and deletes it. Nothing is kept.
 */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  if (!(await allow('setupCheckPerDevice', device.id)))
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  try {
    if (parsed.data.action === 'start') return NextResponse.json(await startUploadTest(device));
    return NextResponse.json({ result: await finishUploadTest(device, parsed.data.id) });
  } catch (err) {
    if (err instanceof StorageUnavailableError)
      return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 });
    throw err;
  }
}
