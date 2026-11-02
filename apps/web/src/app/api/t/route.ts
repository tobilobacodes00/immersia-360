import { NextResponse } from 'next/server';
import { INGEST_MAX_BYTES, ingestBatchSchema } from '@immersia/shared';
import { authenticateIngest, ingestBatch } from '@/server/ingest';
import { allow, clientIp } from '@/server/rate-limit';

/**
 * Client analytics (PRD "Tracked events"), batched: booths and Live Displays buffer events on the
 * device and flush them here with backoff; the studio posts its own. Size and rate limited, and
 * answered per event, so one bad event never costs a batch and a retry never counts twice.
 *
 *   200 { accepted, duplicates, rejected: [{ index, reason }] }
 *   400 the body is not a batch · 401 unknown or revoked credentials · 413 too large · 429 slow down
 */
export async function POST(request: Request) {
  const headers = { 'cache-control': 'no-store' };
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > INGEST_MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413, headers });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return NextResponse.json({ error: 'invalid' }, { status: 400, headers });

  const actor = await authenticateIngest(request);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers });
  if (!(await allow('analyticsIngest', actor.limitKey)) || !(await allow('analyticsIngestIp', await clientIp())))
    return NextResponse.json({ error: 'too_many' }, { status: 429, headers: { ...headers, 'retry-after': '30' } });

  const text = await request.text();
  if (text.length > INGEST_MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413, headers });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400, headers });
  }
  const parsed = ingestBatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400, headers });

  return NextResponse.json(await ingestBatch(actor, parsed.data), { headers });
}
