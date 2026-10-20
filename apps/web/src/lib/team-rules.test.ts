import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_ROLES,
  checkInvitation,
  checkNotOrphaned,
  checkOwnerKept,
  checkRemoval,
  checkRoleChange,
  isOwnerRole,
  isSingleRole,
  memberCapabilities,
  ownerCount,
  type RosterEntry,
} from './team-rules';

const member = (memberId: string, userId: string, role: string): RosterEntry => ({ memberId, userId, role });

/** One owner (Ada), an operator and a viewer. */
const solo = [
  member('m-ada', 'u-ada', 'owner'),
  member('m-op', 'u-op', 'operator'),
  member('m-view', 'u-view', 'viewer'),
];
/** Two owners. */
const duo = [member('m-ada', 'u-ada', 'owner'), member('m-bo', 'u-bo', 'owner'), member('m-op', 'u-op', 'operator')];

describe('roles', () => {
  it('knows which roles can be handed out, and recognises owners inside a role list', () => {
    expect([...ASSIGNABLE_ROLES].sort()).toEqual(['operator', 'owner', 'viewer']);
    expect(isSingleRole('viewer')).toBe(true);
    expect(isSingleRole('viewer,operator')).toBe(false);
    expect(isSingleRole('admin')).toBe(false);
    expect(isSingleRole(undefined)).toBe(false);
    expect(isOwnerRole('owner')).toBe(true);
    expect(isOwnerRole('viewer, owner')).toBe(true);
    expect(isOwnerRole('operator')).toBe(false);
  });

  it('counts owners, including multi-role memberships', () => {
    expect(ownerCount(solo)).toBe(1);
    expect(ownerCount(duo)).toBe(2);
    expect(ownerCount([member('a', 'u', 'viewer,owner')])).toBe(1);
    expect(ownerCount([])).toBe(0);
  });
});

describe('inviting (ACC-3)', () => {
  it('lets owners invite an operator, a viewer or another owner', () => {
    for (const role of ['operator', 'viewer', 'owner']) expect(checkInvitation('owner', role)).toEqual({ ok: true });
  });

  it('refuses operators and viewers, whatever they ask for', () => {
    for (const actor of ['operator', 'viewer'])
      for (const role of ['operator', 'viewer', 'owner'])
        expect(checkInvitation(actor, role), `${actor} inviting ${role}`).toEqual({ ok: false, error: 'forbidden' });
  });

  it('refuses roles that do not exist, and role lists the console could not read', () => {
    for (const role of ['admin', 'member', '', 'viewer,operator'])
      expect(checkInvitation('owner', role)).toEqual({ ok: false, error: 'invalid_role' });
  });
});

describe('changing a role', () => {
  it('lets an owner promote and demote others', () => {
    expect(checkRoleChange({ actorRole: 'owner', roster: solo, targetMemberId: 'm-op', newRole: 'viewer' })).toEqual({
      ok: true,
    });
    expect(checkRoleChange({ actorRole: 'owner', roster: solo, targetMemberId: 'm-view', newRole: 'owner' })).toEqual({
      ok: true,
    });
  });

  it('is for owners only', () => {
    for (const actorRole of ['operator', 'viewer'])
      expect(checkRoleChange({ actorRole, roster: solo, targetMemberId: 'm-view', newRole: 'operator' })).toEqual({
        ok: false,
        error: 'forbidden',
      });
  });

  it('never demotes the last owner, not even the owner themselves', () => {
    for (const newRole of ['operator', 'viewer'])
      expect(checkRoleChange({ actorRole: 'owner', roster: solo, targetMemberId: 'm-ada', newRole })).toEqual({
        ok: false,
        error: 'last_owner',
      });
  });

  it('allows demoting an owner while another owner remains', () => {
    expect(checkRoleChange({ actorRole: 'owner', roster: duo, targetMemberId: 'm-ada', newRole: 'viewer' })).toEqual({
      ok: true,
    });
  });

  it('keeping the last owner an owner is not a change', () => {
    expect(checkRoleChange({ actorRole: 'owner', roster: solo, targetMemberId: 'm-ada', newRole: 'owner' })).toEqual({
      ok: true,
    });
  });

  it('refuses unknown roles and unknown members', () => {
    expect(checkRoleChange({ actorRole: 'owner', roster: solo, targetMemberId: 'm-op', newRole: 'admin' })).toEqual({
      ok: false,
      error: 'invalid_role',
    });
    expect(checkRoleChange({ actorRole: 'owner', roster: solo, targetMemberId: 'nobody', newRole: 'viewer' })).toEqual({
      ok: false,
      error: 'not_a_member',
    });
  });
});

describe('removing a member and leaving', () => {
  const remove = (over: Partial<Parameters<typeof checkRemoval>[0]>) =>
    checkRemoval({
      actorUserId: 'u-ada',
      actorRole: 'owner',
      roster: solo,
      targetMemberId: 'm-op',
      targetOrganizationCount: 2,
      ...over,
    });

  it('lets an owner remove an operator or a viewer', () => {
    expect(remove({ targetMemberId: 'm-op' })).toEqual({ ok: true });
    expect(remove({ targetMemberId: 'm-view' })).toEqual({ ok: true });
  });

  it('does not let operators or viewers remove anyone', () => {
    expect(remove({ actorUserId: 'u-op', actorRole: 'operator', targetMemberId: 'm-view' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(remove({ actorUserId: 'u-view', actorRole: 'viewer', targetMemberId: 'm-op' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('lets any member leave, viewers included', () => {
    expect(remove({ actorUserId: 'u-view', actorRole: 'viewer', targetMemberId: 'm-view' })).toEqual({ ok: true });
    expect(remove({ actorUserId: 'u-op', actorRole: 'operator', targetMemberId: 'm-op' })).toEqual({ ok: true });
  });

  it('keeps the last owner: they can be neither removed nor leave', () => {
    expect(remove({ targetMemberId: 'm-ada' })).toEqual({ ok: false, error: 'last_owner' });
    // ...nor removed by someone else who somehow holds the permission.
    expect(remove({ actorUserId: 'u-other', targetMemberId: 'm-ada' })).toEqual({ ok: false, error: 'last_owner' });
  });

  it('lets one of two owners leave', () => {
    expect(remove({ roster: duo, targetMemberId: 'm-ada' })).toEqual({ ok: true });
    expect(remove({ roster: duo, actorUserId: 'u-bo', targetMemberId: 'm-ada' })).toEqual({ ok: true });
  });

  it('never strands someone without an organization', () => {
    expect(remove({ targetOrganizationCount: 1 })).toEqual({ ok: false, error: 'only_organization' });
    expect(checkNotOrphaned(1)).toEqual({ ok: false, error: 'only_organization' });
    expect(checkNotOrphaned(2)).toEqual({ ok: true });
  });

  it('refuses members who are not in this organization', () => {
    expect(remove({ targetMemberId: 'ghost' })).toEqual({ ok: false, error: 'not_a_member' });
  });
});

describe('the owner invariant on its own (what the auth hooks apply)', () => {
  it('holds for demotion and for removal, and only for the last owner', () => {
    expect(checkOwnerKept(solo, 'm-ada', 'viewer')).toEqual({ ok: false, error: 'last_owner' });
    expect(checkOwnerKept(solo, 'm-ada', null)).toEqual({ ok: false, error: 'last_owner' });
    expect(checkOwnerKept(solo, 'm-ada', 'owner')).toEqual({ ok: true });
    expect(checkOwnerKept(solo, 'm-op', null)).toEqual({ ok: true });
    expect(checkOwnerKept(duo, 'm-ada', null)).toEqual({ ok: true });
    expect(checkOwnerKept(solo, 'ghost', null)).toEqual({ ok: false, error: 'not_a_member' });
  });

  it('is not fooled by a multi-role membership', () => {
    const roster = [member('m-ada', 'u-ada', 'viewer,owner')];
    expect(checkOwnerKept(roster, 'm-ada', 'viewer')).toEqual({ ok: false, error: 'last_owner' });
    expect(checkOwnerKept(roster, 'm-ada', 'viewer,owner')).toEqual({ ok: true });
  });
});

describe('what the team screen offers (cosmetic; the rules above are enforced)', () => {
  const caps = (actorUserId: string, actorRole: string, roster: RosterEntry[], who: string, organizationCount = 2) =>
    memberCapabilities({
      actorUserId,
      actorRole,
      roster,
      member: roster.find((m) => m.memberId === who)!,
      organizationCount,
    });

  it('gives an owner controls over everyone else', () => {
    expect(caps('u-ada', 'owner', duo, 'm-op')).toMatchObject({
      canChangeRole: true,
      canRemove: true,
      canLeave: false,
    });
  });

  it('shows the sole owner no way to step down or leave, and says why', () => {
    expect(caps('u-ada', 'owner', solo, 'm-ada')).toMatchObject({
      self: true,
      canChangeRole: false,
      canLeave: false,
      blockedBy: 'last_owner',
    });
  });

  it('lets one of two owners step down or leave', () => {
    expect(caps('u-ada', 'owner', duo, 'm-ada')).toMatchObject({
      canChangeRole: true,
      canLeave: true,
      blockedBy: null,
    });
  });

  it('shows operators and viewers the team read-only, except leaving', () => {
    for (const [userId, role, memberId] of [
      ['u-op', 'operator', 'm-op'],
      ['u-view', 'viewer', 'm-view'],
    ] as const) {
      expect(caps(userId, role, solo, 'm-ada')).toMatchObject({
        canChangeRole: false,
        canRemove: false,
        canLeave: false,
      });
      expect(caps(userId, role, solo, memberId)).toMatchObject({
        canChangeRole: false,
        canRemove: false,
        canLeave: true,
      });
    }
  });

  it('explains when leaving would strand a member in their only organization', () => {
    expect(caps('u-view', 'viewer', solo, 'm-view', 1)).toMatchObject({
      canLeave: false,
      blockedBy: 'only_organization',
    });
  });
});
