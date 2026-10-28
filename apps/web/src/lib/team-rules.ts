import { isRoleName, roleCan, type RoleName } from './permissions';

/**
 * Team rules (ACC-3), as pure functions so the server, the hooks and the UI agree and the tests can
 * pin them. The server is the authority: `server/team.ts` and the Better Auth organization hooks
 * call these with fresh data, and a database trigger makes the owner rule hold under concurrency.
 */

/** Roles an owner can hand out. Order is the order the role pickers list them in. */
export const ASSIGNABLE_ROLES = ['operator', 'viewer', 'owner'] as const satisfies readonly RoleName[];

export type TeamRuleError =
  /** The actor's role may not do this. */
  | 'forbidden'
  /** Not one of owner, operator, viewer (or a comma-joined mix, which the console cannot read). */
  | 'invalid_role'
  | 'not_a_member'
  /** An organization always keeps at least one owner. */
  | 'last_owner'
  /** Removing someone from their only organization would leave their account with no studio. */
  | 'only_organization';

export type RuleResult = { ok: true } | { ok: false; error: TeamRuleError };

const OK: RuleResult = { ok: true };
const no = (error: TeamRuleError): RuleResult => ({ ok: false, error });

export interface RosterEntry {
  memberId: string;
  userId: string;
  role: string;
}

/** Better Auth stores several roles as "a,b"; a membership is an owner if any of them is. */
export const isOwnerRole = (role: string): boolean =>
  role
    .split(',')
    .map((r) => r.trim())
    .includes('owner');

export const ownerCount = (roster: readonly RosterEntry[]): number => roster.filter((m) => isOwnerRole(m.role)).length;

/** One concrete role: the only shape the console understands (see `getOperator`). */
export const isSingleRole = (role: unknown): role is RoleName => typeof role === 'string' && isRoleName(role);

/**
 * The invariant behind every owner change: after the change the organization still has an owner.
 * `newRole` is the role the target is about to get, or null when they are about to leave.
 */
export function checkOwnerKept(
  roster: readonly RosterEntry[],
  targetMemberId: string,
  newRole: string | null,
): RuleResult {
  const target = roster.find((m) => m.memberId === targetMemberId);
  if (!target) return no('not_a_member');
  const staysOwner = newRole !== null && isOwnerRole(newRole);
  if (isOwnerRole(target.role) && !staysOwner && ownerCount(roster) <= 1) return no('last_owner');
  return OK;
}

/** Nobody is removed from their only organization: the console has nowhere to put them. */
export function checkNotOrphaned(targetOrganizationCount: number): RuleResult {
  return targetOrganizationCount <= 1 ? no('only_organization') : OK;
}

/** Can this role invite someone as `role`? Owners only (they alone hold invitation:create). */
export function checkInvitation(actorRole: string, role: string): RuleResult {
  if (!isSingleRole(role)) return no('invalid_role');
  if (!roleCan(actorRole, { invitation: ['create'] })) return no('forbidden');
  // Handing out ownership is itself an owner-only act, whatever the role table says.
  if (role === 'owner' && !isOwnerRole(actorRole)) return no('forbidden');
  return OK;
}

/**
 * Change a member's role. Only members who may `member:update` (owners); the last owner cannot be
 * demoted — including by themselves.
 */
export function checkRoleChange(input: {
  actorRole: string;
  roster: readonly RosterEntry[];
  targetMemberId: string;
  newRole: string;
}): RuleResult {
  const { actorRole, roster, targetMemberId, newRole } = input;
  if (!isSingleRole(newRole)) return no('invalid_role');
  if (!roleCan(actorRole, { member: ['update'] })) return no('forbidden');
  if (!roster.some((m) => m.memberId === targetMemberId)) return no('not_a_member');
  if (newRole === 'owner' && !isOwnerRole(actorRole)) return no('forbidden');
  return checkOwnerKept(roster, targetMemberId, newRole);
}

/**
 * Remove a member, or leave (when the target is the actor). Leaving needs no permission; removing
 * someone else needs `member:delete`. The last owner can be neither removed nor leave, and nobody
 * is removed from their only organization.
 */
export function checkRemoval(input: {
  actorUserId: string;
  actorRole: string;
  roster: readonly RosterEntry[];
  targetMemberId: string;
  /** How many organizations the target belongs to, this one included. */
  targetOrganizationCount: number;
}): RuleResult {
  const { actorUserId, actorRole, roster, targetMemberId, targetOrganizationCount } = input;
  const target = roster.find((m) => m.memberId === targetMemberId);
  if (!target) return no('not_a_member');
  const leaving = target.userId === actorUserId;
  if (!leaving && !roleCan(actorRole, { member: ['delete'] })) return no('forbidden');
  const kept = checkOwnerKept(roster, targetMemberId, null);
  return kept.ok ? checkNotOrphaned(targetOrganizationCount) : kept;
}

/** What the team screen may offer a viewer of the roster (cosmetic; the rules above are enforced). */
export function memberCapabilities(input: {
  actorUserId: string;
  actorRole: string;
  roster: readonly RosterEntry[];
  member: RosterEntry;
  /** Organizations the member belongs to; only the actor's own count is known client-side. */
  organizationCount: number;
}) {
  const { actorUserId, actorRole, roster, member, organizationCount } = input;
  const self = member.userId === actorUserId;
  const removal = checkRemoval({
    actorUserId,
    actorRole,
    roster,
    targetMemberId: member.memberId,
    targetOrganizationCount: self ? organizationCount : Number.POSITIVE_INFINITY,
  });
  const demotion = checkRoleChange({ actorRole, roster, targetMemberId: member.memberId, newRole: 'viewer' });
  return {
    self,
    /** The role picker is live. A sole owner's stays off: nothing they pick could be allowed. */
    canChangeRole: roleCan(actorRole, { member: ['update'] }) && !(isOwnerRole(member.role) && !demotion.ok),
    canRemove: !self && removal.ok,
    canLeave: self && removal.ok,
    /** Why leaving (or removing) is off, so the screen can say so instead of just greying out. */
    blockedBy: removal.ok ? null : removal.error,
  };
}
