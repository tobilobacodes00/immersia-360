import { NextResponse } from 'next/server';
import { exportFilename } from '@/lib/privacy';
import { roleCan } from '@/lib/permissions';
import { audit } from '@/server/audit';
import { exportOrganization } from '@/server/privacy';
import { allow } from '@/server/rate-limit';
import { getOperator } from '@/server/session';
import { db, schema } from '@immersia/db';
import { eq } from 'drizzle-orm';

/**
 * "Export my data" (GDPR Art. 20): the organization's events, settings, devices (no secrets),
 * integrations (no tokens) and guest contacts as one JSON download. Owner only, because it contains
 * the team's and the guests' personal data. No media.
 */
export async function GET() {
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
  const op = await getOperator();
  if (!op) return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers });
  if (!roleCan(op.role, { account: ['export'] }))
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers });
  if (!(await allow('privacyExportPerOrg', op.organizationId)))
    return NextResponse.json({ error: 'too_many' }, { status: 429, headers: { ...headers, 'retry-after': '600' } });
  const data = await exportOrganization(op.organizationId);
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404, headers });
  const [org] = await db()
    .select({ slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, op.organizationId))
    .limit(1);
  await audit({
    organizationId: op.organizationId,
    actorUserId: op.userId,
    action: 'organization.exported',
    target: op.organizationId,
  });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      ...headers,
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFilename(org?.slug ?? '', new Date())}"`,
    },
  });
}
