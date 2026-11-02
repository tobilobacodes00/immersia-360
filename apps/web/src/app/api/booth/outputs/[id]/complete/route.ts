import { NextResponse } from 'next/server';
import { authenticateDevice } from '@/server/devices';
import { completeUpload } from '@/server/sessions';

// Work scheduled with after() (the copy to the operator's own cloud, SHR-7) runs inside this
// function's time limit, so allow the longest the platform offers.
export const maxDuration = 300;

/** Confirm an upload: the server checks the object really landed at the expected size. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const result = await completeUpload(device, id);
  const status = result === 'ok' ? 200 : result === 'not_found' ? 404 : 409;
  return NextResponse.json({ result }, { status });
}
