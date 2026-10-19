import { NextResponse } from 'next/server';
import { roleCan } from '@/lib/permissions';
import { getEvent } from '@/server/events';
import { zipFiles } from '@/server/gallery';
import { getOperator } from '@/server/session';

/** EVT-4: every file of the event (hidden and opted-out ones included) for the operator's ZIP. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const op = await getOperator();
  if (!op || !roleCan(op.role, { gallery: ['export'] }))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await getEvent(op.organizationId, id)))
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const cursor = new URL(request.url).searchParams.get('cursor');
  return NextResponse.json(await zipFiles(id, { everything: true, cursor }), {
    headers: { 'cache-control': 'no-store' },
  });
}
