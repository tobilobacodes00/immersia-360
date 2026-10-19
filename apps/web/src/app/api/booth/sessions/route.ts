import { NextResponse } from 'next/server';
import { registerSessionSchema } from '@immersia/shared';
import { authenticateDevice } from '@/server/devices';
import { registerSession } from '@/server/sessions';
import { StorageUnavailableError } from '@/server/storage';

/**
 * Register a guest session and its outputs; responds with presigned upload URLs for outputs not
 * yet stored. Idempotent: the booth retries freely after a lost response.
 */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  const parsed = registerSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'invalid', issues: parsed.error.issues.length }, { status: 400 });
  try {
    const res = await registerSession(device, parsed.data);
    if ('error' in res) return NextResponse.json(res, { status: res.error === 'not_found' ? 404 : 409 });
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof StorageUnavailableError)
      return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 });
    throw err;
  }
}
