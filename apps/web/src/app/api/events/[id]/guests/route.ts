import { NextResponse } from 'next/server';
import { sessionUrl } from '@immersia/shared';
import { CSV_BOM, csvRow } from '@/lib/csv';
import { roleCan } from '@/lib/permissions';
import { audit } from '@/server/audit';
import { appOrigin } from '@/server/env';
import { getEvent } from '@/server/events';
import { contactBatches } from '@/server/guests';
import { allow } from '@/server/rate-limit';
import { getOperator } from '@/server/session';

const HEADER = [
  'Name',
  'Email',
  'Consent given (UTC)',
  'Consent wording',
  'Consent language',
  'Privacy policy shown',
  'Source',
  'Session code',
  'Session link',
];

/**
 * SHR-6: the event's guest contacts as a CSV, for owners and operators only (it is personal data;
 * viewers see counts on the Guests screen and nothing else). UTF-8 with a byte-order mark so Excel
 * reads accents, and every cell that could be a spreadsheet formula is neutralised (lib/csv.ts).
 * Streamed in batches; the export is recorded in the audit log.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
  const op = await getOperator();
  if (!op) return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers });
  if (!roleCan(op.role, { guest: ['export'] }))
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404, headers });
  const event = await getEvent(op.organizationId, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404, headers });
  if (!(await allow('privacyExportPerOrg', op.organizationId)))
    return NextResponse.json({ error: 'too_many' }, { status: 429, headers: { ...headers, 'retry-after': '600' } });

  const origin = appOrigin();
  const batches = contactBatches(op.organizationId, id);
  let count = 0;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`${CSV_BOM}${csvRow(HEADER)}\r\n`));
    },
    async pull(controller) {
      const next = await batches.next();
      if (next.done) {
        await audit({
          organizationId: op.organizationId,
          actorUserId: op.userId,
          action: 'guest.contacts_exported',
          target: id,
          meta: { count },
        }).catch((err: unknown) => console.error('[audit] export entry failed', err));
        controller.close();
        return;
      }
      count += next.value.length;
      const lines = next.value.map((c) =>
        csvRow([
          c.name,
          c.email,
          c.consentAt,
          c.consentText,
          c.consentLocale,
          c.policyUrl,
          c.sessionId ? 'session' : 'gallery',
          c.sessionCode,
          c.linkId ? sessionUrl(origin, c.linkId, 'direct') : null,
        ]),
      );
      controller.enqueue(encoder.encode(`${lines.join('\r\n')}\r\n`));
    },
    async cancel() {
      await batches.return(undefined);
    },
  });
  const filename = `guests-${event.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'event'}.csv`;
  return new Response(body, {
    headers: {
      ...headers,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]+/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
