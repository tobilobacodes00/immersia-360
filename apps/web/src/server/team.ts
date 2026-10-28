import 'server-only';
import { headers } from 'next/headers';
import { z } from 'zod';
import { isInvitationId } from '@/lib/invite-state';
import { ASSIGNABLE_ROLES, checkInvitation, checkRemoval, checkRoleChange, isSingleRole } from '@/lib/team-rules';
import { fail, ok, type ActionError, type ActionResult } from './action-result';
import { auth } from './auth';
import { allow } from './rate-limit';
import type { Operator } from './session';
import {
  clearActiveOrganization,
  findOrganizationInvitation,
  isMemberOf,
  loadRoster,
  organizationCountOf,
  organizationsOf,
  resolveInvite,
} from './team-data';
import { teamIssue, type TeamIssue } from './team-errors';

/**
 * Team operations (ACC-3) behind the server actions in app/studio/devices/team-actions.ts and
 * app/invite/actions.ts. Each one re-reads the roster, applies the rules in lib/team-rules.ts, and
 * only then asks Better Auth's organization plugin to do the work; the plugin's hooks (auth.ts)
 * and the `org_keeps_owner` trigger enforce the same rules again, for every other way in.
 */

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  role: z.enum(ASSIGNABLE_ROLES),
});

/** Better Auth ids are opaque strings; keep anything else away from the queries. */
const authId = z.string().refine(isInvitationId);

/** An issue code as the action result the screens read: `error` for the class, `issues` for the code. */
function failIssue(issue: TeamIssue): ActionResult<never> {
  const error: ActionError = (() => {
    switch (issue) {
      case 'forbidden':
        return 'forbidden';
      case 'rate_limited':
        return 'rate_limited';
      case 'not_found':
      case 'not_a_member':
        return 'not_found';
      case 'invalid_role':
      case 'invalid_email':
        return 'invalid';
      default:
        return 'conflict';
    }
  })();
  return fail(error, [issue]);
}

/** Known failures become results the screen can explain; anything else propagates and is logged. */
function failFrom(err: unknown): ActionResult<never> {
  const issue = teamIssue(err);
  if (!issue) throw err;
  return failIssue(issue);
}

const requestHeaders = () => headers();

// -----------------------------------------------------------------------------------------------
// Invitations

/** Invite by email as operator or viewer (or owner). The plugin emails the link and sets the 7-day expiry. */
export async function inviteMember(op: Operator, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success)
    return failIssue(parsed.error.issues.some((i) => i.path[0] === 'role') ? 'invalid_role' : 'invalid_email');
  const { email, role } = parsed.data;
  const allowed = checkInvitation(op.role, role);
  if (!allowed.ok) return failIssue(allowed.error);
  try {
    const invitation = await auth().api.createInvitation({
      headers: await requestHeaders(),
      body: { email, role, organizationId: op.organizationId },
    });
    return ok({ id: invitation.id });
  } catch (err) {
    return failFrom(err);
  }
}

/** Send a pending invitation again. An expired one is replaced by a fresh invitation. */
export async function resendInvitation(op: Operator, invitationId: unknown): Promise<ActionResult> {
  const id = authId.safeParse(invitationId);
  if (!id.success) return failIssue('not_found');
  const row = await findOrganizationInvitation(op.organizationId, id.data);
  if (!row || row.status !== 'pending') return failIssue('not_found');
  if (!(await allow('inviteResendPerInvitation', row.id))) return failIssue('rate_limited');
  try {
    const expired = row.expiresAt.getTime() <= Date.now();
    await auth().api.createInvitation({
      headers: await requestHeaders(),
      body: {
        email: row.email,
        role: isSingleRole(row.role) ? row.role : 'viewer',
        organizationId: op.organizationId,
        // A live invitation keeps its link and gets a new week; an expired one cannot be revived.
        resend: !expired,
      },
    });
    if (expired) {
      await auth().api.cancelInvitation({ headers: await requestHeaders(), body: { invitationId: row.id } });
    }
    return ok(undefined);
  } catch (err) {
    return failFrom(err);
  }
}

export async function revokeInvitation(op: Operator, invitationId: unknown): Promise<ActionResult> {
  const id = authId.safeParse(invitationId);
  if (!id.success) return failIssue('not_found');
  const row = await findOrganizationInvitation(op.organizationId, id.data);
  if (!row || row.status !== 'pending') return failIssue('not_found');
  try {
    await auth().api.cancelInvitation({ headers: await requestHeaders(), body: { invitationId: row.id } });
    return ok(undefined);
  } catch (err) {
    return failFrom(err);
  }
}

// -----------------------------------------------------------------------------------------------
// Members

const roleChangeSchema = z.object({ memberId: authId, role: z.enum(ASSIGNABLE_ROLES) });

export async function changeMemberRole(op: Operator, input: unknown): Promise<ActionResult> {
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) return failIssue('invalid_role');
  const { memberId, role } = parsed.data;
  const roster = await loadRoster(op.organizationId);
  const allowed = checkRoleChange({ actorRole: op.role, roster, targetMemberId: memberId, newRole: role });
  if (!allowed.ok) return failIssue(allowed.error);
  try {
    await auth().api.updateMemberRole({
      headers: await requestHeaders(),
      body: { memberId, role, organizationId: op.organizationId },
    });
    return ok(undefined);
  } catch (err) {
    return failFrom(err);
  }
}

/** Remove someone else from the organization (leaving is `leaveOrganization`). */
export async function removeMember(op: Operator, memberId: unknown): Promise<ActionResult> {
  const id = authId.safeParse(memberId);
  if (!id.success) return failIssue('not_a_member');
  const roster = await loadRoster(op.organizationId);
  const target = roster.find((m) => m.memberId === id.data);
  if (!target) return failIssue('not_a_member');
  if (target.userId === op.userId) return leaveOrganization(op);
  const allowed = checkRemoval({
    actorUserId: op.userId,
    actorRole: op.role,
    roster,
    targetMemberId: target.memberId,
    targetOrganizationCount: await organizationCountOf(target.userId),
  });
  if (!allowed.ok) return failIssue(allowed.error);
  try {
    await auth().api.removeMember({
      headers: await requestHeaders(),
      body: { memberIdOrEmail: target.memberId, organizationId: op.organizationId },
    });
    await clearActiveOrganization(target.userId, op.organizationId);
    return ok(undefined);
  } catch (err) {
    return failFrom(err);
  }
}

/** Leave the active organization, and land in the next one the user belongs to. */
export async function leaveOrganization(op: Operator): Promise<ActionResult> {
  const roster = await loadRoster(op.organizationId);
  const me = roster.find((m) => m.userId === op.userId);
  if (!me) return failIssue('not_a_member');
  const allowed = checkRemoval({
    actorUserId: op.userId,
    actorRole: op.role,
    roster,
    targetMemberId: me.memberId,
    targetOrganizationCount: await organizationCountOf(op.userId),
  });
  if (!allowed.ok) return failIssue(allowed.error);
  try {
    await auth().api.leaveOrganization({
      headers: await requestHeaders(),
      body: { organizationId: op.organizationId },
    });
    await clearActiveOrganization(op.userId, op.organizationId);
    // Point the session (and its cookie) at somewhere they still belong.
    const [next] = await organizationsOf(op.userId);
    if (next) await switchTo(next.id);
    return ok(undefined);
  } catch (err) {
    return failFrom(err);
  }
}

// -----------------------------------------------------------------------------------------------
// Organizations

async function switchTo(organizationId: string): Promise<void> {
  await auth().api.setActiveOrganization({ headers: await requestHeaders(), body: { organizationId } });
}

/** Make another of the user's organizations the active one. */
export async function switchOrganization(user: { id: string }, organizationId: unknown): Promise<ActionResult> {
  const id = authId.safeParse(organizationId);
  if (!id.success || !(await isMemberOf(user.id, id.data))) return failIssue('not_found');
  try {
    await switchTo(id.data);
    return ok(undefined);
  } catch (err) {
    return failFrom(err);
  }
}

// -----------------------------------------------------------------------------------------------
// Accepting an invitation (the invitee, who is not yet a member of the organization)

/**
 * Accept an invitation addressed to the signed-in account and make its organization the active one.
 * The page has shown the state already; this decides again, because the link can be used twice.
 */
export async function acceptInvitation(
  user: { id: string; email: string },
  invitationId: unknown,
): Promise<ActionResult<{ organizationId: string }>> {
  const id = authId.safeParse(invitationId);
  if (!id.success) return fail('not_found', ['not_found']);
  const { facts, view } = await resolveInvite(id.data, user);
  if (!facts || (view !== 'ready' && view !== 'already_member')) return fail('conflict', [view]);
  try {
    if (view === 'ready') {
      await auth().api.acceptInvitation({ headers: await requestHeaders(), body: { invitationId: facts.id } });
    }
    await switchTo(facts.organizationId);
    return ok({ organizationId: facts.organizationId });
  } catch (err) {
    return failFrom(err);
  }
}

export async function declineInvitation(
  user: { id: string; email: string },
  invitationId: unknown,
): Promise<ActionResult> {
  const id = authId.safeParse(invitationId);
  if (!id.success) return fail('not_found', ['not_found']);
  const { facts, view } = await resolveInvite(id.data, user);
  if (!facts || view !== 'ready') return fail('conflict', [view]);
  try {
    await auth().api.rejectInvitation({ headers: await requestHeaders(), body: { invitationId: facts.id } });
    return ok(undefined);
  } catch (err) {
    return failFrom(err);
  }
}
