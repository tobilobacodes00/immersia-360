'use server';

import { revalidatePath } from 'next/cache';
import { withSession, type ActionResult } from '@/server/action-result';
import { acceptInvitation, declineInvitation } from '@/server/team';

/**
 * The invitee's side of ACC-3. Not role-gated: the person accepting is not a member yet, so the
 * check is that the invitation is addressed to the signed-in account (re-verified in
 * `@/server/team` and again by Better Auth).
 */

export async function acceptInvitationAction(invitationId: string): Promise<ActionResult<{ organizationId: string }>> {
  return withSession(async (user) => {
    const result = await acceptInvitation(user, invitationId);
    // The studio the invitee lands in is a different organization from the one it last rendered.
    if (result.ok) revalidatePath('/studio', 'layout');
    return result;
  });
}

export async function declineInvitationAction(invitationId: string): Promise<ActionResult> {
  return withSession(async (user) => declineInvitation(user, invitationId));
}
