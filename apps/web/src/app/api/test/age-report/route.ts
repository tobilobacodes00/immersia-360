import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { isE2ERequest } from '@/server/e2e';

/**
 * E2E only ("a report past its 24 hours is highlighted"): move a report's filing time back, as if it
 * had been waiting that long. Disabled unless E2E=1 and the request carries the run's E2E_TOKEN.
 */
export async function POST(request: Request) {
  if (!isE2ERequest(request)) return new NextResponse(null, { status: 404 });
  const q = new URL(request.url).searchParams;
  const id = q.get('id') ?? '';
  const hours = Number(q.get('hours'));
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isFinite(hours) || hours <= 0 || hours > 24 * 30)
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const rows = await db()
    .update(schema.report)
    .set({ createdAt: new Date(Date.now() - hours * 3_600_000) })
    .where(eq(schema.report.id, id))
    .returning({ id: schema.report.id });
  return NextResponse.json({ updated: rows.length });
}
