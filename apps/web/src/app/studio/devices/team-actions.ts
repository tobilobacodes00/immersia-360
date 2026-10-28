'use server';

import { revalidatePath } from 'next/cache';
import { withMember, withOperator, withSession, type ActionResult } from '@/server/action-result';
import {
  changeMemberRole,
  inviteMember,
  leaveOrganization,
  removeMember,
  resendInvitation,
  revokeInvitation,
  switchOrganization,
} from '@/server/team';

/**
 * ACC-3 / screen 21: the team. Every action re-checks the session and the role on the server
 * (the buttons are hidden for roles that lack them, but that is cosmetic), and the team rules
 * (an organization always keeps an owner) are applied again in `@/server/team`.
 */

/** A change to the team can change what the signed-in user themselves may see, so refresh the shell too. */
const refresh = <T>(result: ActionResult<T>): ActionResult<T> => {
  if (result.ok) revalidatePath('/studio', 'layout');
  return result;
};

export async function inviteMemberAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return withOperator({ invitation: ['create'] }, async (op) => refresh(await inviteMember(op, input)));
}

export async function resendInvitationAction(invitationId: string): Promise<ActionResult> {
  return withOperator({ invitation: ['create'] }, async (op) => refresh(await resendInvitation(op, invitationId)));
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionResult> {
  return withOperator({ invitation: ['cancel'] }, async (op) => refresh(await revokeInvitation(op, invitationId)));
}

export async function changeMemberRoleAction(input: unknown): Promise<ActionResult> {
  return withOperator({ member: ['update'] }, async (op) => refresh(await changeMemberRole(op, input)));
}

export async function removeMemberAction(memberId: string): Promise<ActionResult> {
  return withOperator({ member: ['delete'] }, async (op) => refresh(await removeMember(op, memberId)));
}

/** Any member may leave, whatever their role; the last owner may not (enforced in `@/server/team`). */
export async function leaveOrganizationAction(): Promise<ActionResult> {
  return withMember(async (op) => refresh(await leaveOrganization(op)));
}

/** Make another of the user's own organizations the active one. */
export async function switchOrganizationAction(organizationId: string): Promise<ActionResult> {
  return withSession(async (user) => refresh(await switchOrganization(user, organizationId)));
}
