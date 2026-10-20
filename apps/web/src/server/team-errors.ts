import 'server-only';
import { APIError, isAPIError } from 'better-auth/api';
import type { TeamRuleError } from '@/lib/team-rules';

/**
 * One vocabulary for everything that can go wrong with the team: our own rules, Better Auth's
 * organization plugin, and the database's last-owner trigger. The screens turn these codes into
 * localized sentences; nothing here is shown to a user as-is.
 */
export type TeamIssue =
  | TeamRuleError
  | 'already_member'
  | 'invitation_limit'
  | 'membership_limit'
  | 'rate_limited'
  | 'not_found'
  | 'wrong_account'
  | 'invalid_email';

const RULE_MESSAGES: Record<TeamRuleError, string> = {
  forbidden: 'You are not allowed to do that.',
  invalid_role: 'That is not a role this organization can assign.',
  not_a_member: 'That person is not a member of this organization.',
  last_owner: 'An organization always needs at least one owner.',
  only_organization: 'That would leave this person without any organization.',
};

/** Our codes carry this prefix so they can never be mistaken for one of Better Auth's (TEAM_NOT_FOUND, ...). */
const RULE_CODE_PREFIX = 'TEAM_RULE_';

/** A rule violation as the API error Better Auth's hooks and endpoints throw. */
export function ruleError(error: TeamRuleError): APIError {
  return APIError.from(error === 'forbidden' ? 'FORBIDDEN' : 'BAD_REQUEST', {
    code: `${RULE_CODE_PREFIX}${error.toUpperCase()}`,
    message: RULE_MESSAGES[error],
  });
}

/** Better Auth's own codes for the same situations. */
const BETTER_AUTH_CODES: Record<string, TeamIssue> = {
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: 'last_owner',
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: 'last_owner',
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: 'already_member',
  INVITATION_LIMIT_REACHED: 'invitation_limit',
  ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: 'membership_limit',
  INVITATION_NOT_FOUND: 'not_found',
  MEMBER_NOT_FOUND: 'not_a_member',
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: 'wrong_account',
  INVALID_EMAIL: 'invalid_email',
  INVITATION_RATE_LIMITED: 'rate_limited',
  ROLE_NOT_FOUND: 'invalid_role',
};

/** Walk an error's `cause` chain (drizzle wraps the driver's error). */
function* chain(err: unknown): Generator<unknown> {
  for (let e = err, depth = 0; e && depth < 6; depth++) {
    yield e;
    e = (e as { cause?: unknown }).cause;
  }
}

/** The database trigger that keeps an owner in every organization (see the org_keeps_owner migration). */
const isOwnerTrigger = (e: unknown) =>
  typeof e === 'object' &&
  e !== null &&
  (e as { code?: unknown }).code === '23514' &&
  String((e as { message?: unknown }).message).includes('organization_needs_owner');

/** Map anything thrown while changing the team to an issue code, or null when it is not one of ours. */
export function teamIssue(err: unknown): TeamIssue | null {
  for (const e of chain(err)) {
    if (isOwnerTrigger(e)) return 'last_owner';
    if (!isAPIError(e)) continue;
    const body = (e as APIError).body as { code?: string } | undefined;
    const code = body?.code ?? '';
    const known = Object.hasOwn(BETTER_AUTH_CODES, code) ? BETTER_AUTH_CODES[code] : undefined;
    if (known) return known;
    if (code.startsWith(RULE_CODE_PREFIX)) {
      const rule = code.slice(RULE_CODE_PREFIX.length).toLowerCase();
      if (Object.hasOwn(RULE_MESSAGES, rule)) return rule as TeamRuleError;
    }
    const status = (e as APIError).statusCode;
    if (status === 429) return 'rate_limited';
    if (status === 403 || status === 401) return 'forbidden';
    if (code.startsWith('YOU_ARE_NOT_ALLOWED')) return 'forbidden';
  }
  return null;
}
