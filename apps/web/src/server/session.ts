import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { isRoleName, roleCan, type Permission, type RoleName } from '@/lib/permissions';
import { auth } from './auth';

export class ForbiddenError extends Error {
  constructor(message = 'You do not have permission to do that.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export interface Operator {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  role: RoleName;
}

/** Better Auth session for this request (deduplicated per render). */
export const getSession = cache(async () => auth().api.getSession({ headers: await headers() }));

/**
 * The signed-in operator and their active organization, with their role read from the database
 * (never trusted from the client). Falls back to the first membership if the active one is gone.
 */
export const getOperator = cache(async (): Promise<Operator | null> => {
  const session = await getSession();
  if (!session) return null;
  const active = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
  const rows = await db()
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
      organizationName: schema.organization.name,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(
      active
        ? and(eq(schema.member.userId, session.user.id), eq(schema.member.organizationId, active))
        : eq(schema.member.userId, session.user.id),
    )
    .orderBy(asc(schema.member.createdAt))
    .limit(1);
  let membership = rows[0];
  if (!membership && active) {
    const [first] = await db()
      .select({
        organizationId: schema.member.organizationId,
        role: schema.member.role,
        organizationName: schema.organization.name,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, session.user.id))
      .orderBy(asc(schema.member.createdAt))
      .limit(1);
    membership = first;
  }
  if (!membership || !isRoleName(membership.role)) return null;
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
    role: membership.role,
  };
});

/** For pages: redirect to sign-in when signed out; throw ForbiddenError when the role can't. */
export async function requireOperator(permission?: Permission): Promise<Operator> {
  const operator = await getOperator();
  if (!operator) redirect('/sign-in');
  if (permission && !roleCan(operator.role, permission)) throw new ForbiddenError();
  return operator;
}
