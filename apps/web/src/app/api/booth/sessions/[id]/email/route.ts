import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateDevice } from '@/server/devices';
import { localeFromRequest } from '@/server/email';
import { emailSessionLink } from '@/server/sessions';

const bodySchema = z.object({ email: z.email().max(254) });

/** SHR-2: the booth asks for a guest's link to be emailed (sent from the upload queue). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: 'device_unauthorized' }, { status: 401 });
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!/^[0-9a-f-]{36}$/i.test(id) || !parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const result = await emailSessionLink(device, id, parsed.data.email, localeFromRequest(request.headers));
  if (result === 'erased') return NextResponse.json({ error: 'session_erased' }, { status: 410 });
  const status = result === 'sent' ? 200 : result === 'not_found' ? 404 : 429;
  return NextResponse.json({ result }, { status });
}
