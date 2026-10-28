/**
 * What the invitation page (`/invite/[id]`) should say, as one pure decision so every state is
 * pinned by a test. The order matters: whoever holds the link learns nothing about an invitation
 * that is not addressed to their account beyond a masked address to sign in with.
 */
export type InviteView =
  /** No such invitation (or an id that cannot be one). */
  | 'not_found'
  /** Signed in as someone else. The page names the address to use, masked. */
  | 'wrong_account'
  | 'expired'
  | 'cancelled'
  | 'declined'
  /** Accepted before, by an account that is no longer a member. */
  | 'used'
  /** Pending or accepted, and this account is already in the organization. */
  | 'already_member'
  | 'ready';

/** Better Auth's ids are opaque url-safe strings; anything else cannot be an invitation. */
export const isInvitationId = (value: string): boolean => /^[\w-]{8,64}$/.test(value);

export interface InviteFacts {
  email: string;
  /** Better Auth's statuses: pending, accepted, rejected, canceled. */
  status: string;
  expiresAt: Date;
}

export function inviteView(input: {
  invitation: InviteFacts | null;
  /** The signed-in user's address. */
  userEmail: string;
  /** The signed-in user already belongs to the invitation's organization. */
  isMember: boolean;
  now: Date;
}): InviteView {
  const { invitation, userEmail, isMember, now } = input;
  if (!invitation) return 'not_found';
  if (invitation.email.trim().toLowerCase() !== userEmail.trim().toLowerCase()) return 'wrong_account';
  switch (invitation.status) {
    case 'accepted':
      return isMember ? 'already_member' : 'used';
    case 'canceled':
    case 'cancelled':
      return 'cancelled';
    case 'rejected':
      return 'declined';
    case 'pending':
      if (invitation.expiresAt.getTime() <= now.getTime()) return 'expired';
      return isMember ? 'already_member' : 'ready';
    default:
      return 'not_found';
  }
}

/** "jane.doe@studio.com" → "j***@studio.com": enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
