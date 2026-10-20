import 'server-only';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { formatRelative } from '@/lib/format';
import { inviteView, isInvitationId } from '@/lib/invite-state';
import type { RosterEntry } from '@/lib/team-rules';

/**
 * Reads behind the team screen, the invitation page and the organization hooks. Kept free of the
 * Better Auth instance so `auth.ts` can use it from its hooks without an import cycle.
 */

const { member, user, organization, invitation, session } = schema;

/** Just enough of every member to apply the owner rules (see lib/team-rules.ts). */
export async function loadRoster(organizationId: string): Promise<RosterEntry[]> {
  return db()
    .select({ memberId: member.id, userId: member.userId, role: member.role })
    .from(member)
    .where(eq(member.organizationId, organizationId));
}

/** How many organizations a user belongs to. */
export async function organizationCountOf(userId: string): Promise<number> {
  const [row] = await db().select({ n: count() }).from(member).where(eq(member.userId, userId));
  return row?.n ?? 0;
}

export interface MemberView {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: Date;
}

/** Owners first, then by who joined first. */
export async function listMembers(organizationId: string): Promise<MemberView[]> {
  const rows = await db()
    .select({
      memberId: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId))
    .orderBy(asc(member.createdAt));
  const rank = (role: string) => (role === 'owner' ? 0 : role === 'operator' ? 1 : 2);
  return rows.sort((a, b) => rank(a.role) - rank(b.role) || a.joinedAt.getTime() - b.joinedAt.getTime());
}

export interface InvitationView {
  id: string;
  email: string;
  role: string;
  invitedBy: string;
  createdAt: Date;
  expiresAt: Date;
}

/** Invitations still waiting for an answer, newest first. Expired ones stay listed so they can be re-sent. */
export async function listPendingInvitations(organizationId: string): Promise<InvitationView[]> {
  const rows = await db()
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      inviterName: user.name,
      inviterEmail: user.email,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending')))
    .orderBy(desc(invitation.createdAt));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role ?? 'viewer',
    invitedBy: r.inviterName || r.inviterEmail,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  }));
}

/** When an invitation lapses, in words, and whether it already has. Computed here, outside any render. */
export function expiryOf(expiresAt: Date, locale: string): { expired: boolean; expires: string } {
  const now = Date.now();
  return { expired: expiresAt.getTime() <= now, expires: formatRelative(expiresAt, locale, now) };
}

/** One invitation of an organization (or null), for resend and revoke to check ownership first. */
export async function findOrganizationInvitation(organizationId: string, invitationId: string) {
  const [row] = await db()
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  role: string;
}

/** Every organization the user belongs to, oldest membership first. */
export async function organizationsOf(userId: string): Promise<OrganizationSummary[]> {
  return db()
    .select({ id: organization.id, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));
}

/** The facts the invitation page needs; it never reads more than the id's owner may see. */
export async function loadInvitation(invitationId: string) {
  const [row] = await db()
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organizationId: invitation.organizationId,
      organizationName: organization.name,
      inviterName: user.name,
      inviterEmail: user.email,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(eq(invitation.id, invitationId))
    .limit(1);
  return row ?? null;
}

/** An invitation as the signed-in user sees it: its facts (if any) and what the page should say. */
export async function resolveInvite(invitationId: string, user: { id: string; email: string }) {
  const facts = isInvitationId(invitationId) ? await loadInvitation(invitationId) : null;
  const isMember = facts ? await isMemberOf(user.id, facts.organizationId) : false;
  const view = inviteView({ invitation: facts, userEmail: user.email, isMember, now: new Date() });
  return { facts, view };
}

export async function isMemberOf(userId: string, organizationId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Sessions that still point at an organization their user has left (or been removed from) are reset,
 * so nothing that defaults to the active organization lands on one they can no longer see.
 */
export async function clearActiveOrganization(userId: string, organizationId: string): Promise<void> {
  await db()
    .update(session)
    .set({ activeOrganizationId: null })
    .where(and(eq(session.userId, userId), eq(session.activeOrganizationId, organizationId)));
}
