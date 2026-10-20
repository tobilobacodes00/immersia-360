import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { isE2ERequest } from '@/server/e2e';

/**
 * E2E only: the analytics rows recorded for an event (or with a given name), newest first, so a test
 * can assert what a page view or a booth really reported. Disabled unless E2E=1 and the request
 * carries the run's E2E_TOKEN.
 */
export async function GET(request: Request) {
  if (!isE2ERequest(request)) return new NextResponse(null, { status: 404 });
  const q = new URL(request.url).searchParams;
  const eventId = q.get('eventId');
  const name = q.get('name');
  if (!eventId && !name) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  if (eventId && !/^[0-9a-f-]{36}$/i.test(eventId)) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const rows = await db()
    .select({
      name: schema.analyticsEvent.name,
      props: schema.analyticsEvent.props,
      source: schema.analyticsEvent.source,
      eventId: schema.analyticsEvent.eventId,
      deviceId: schema.analyticsEvent.deviceId,
      occurredAt: schema.analyticsEvent.occurredAt,
    })
    .from(schema.analyticsEvent)
    .where(
      and(
        eventId ? eq(schema.analyticsEvent.eventId, eventId) : undefined,
        name ? eq(schema.analyticsEvent.name, name) : undefined,
      ),
    )
    .orderBy(desc(schema.analyticsEvent.occurredAt))
    .limit(200);
  return NextResponse.json({ rows });
}
