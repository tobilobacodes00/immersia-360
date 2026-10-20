import { describe, expect, it } from 'vitest';
import { inviteView, isInvitationId, maskEmail, type InviteFacts } from './invite-state';

const now = new Date('2026-10-20T12:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);
const invite = (over: Partial<InviteFacts> = {}): InviteFacts => ({
  email: 'jane@studio.com',
  status: 'pending',
  expiresAt: inDays(3),
  ...over,
});
const view = (invitation: InviteFacts | null, userEmail = 'jane@studio.com', isMember = false) =>
  inviteView({ invitation, userEmail, isMember, now });

describe('the invitation page (ACC-3)', () => {
  it('is ready for the addressee while the invitation is pending and unexpired', () => {
    expect(view(invite())).toBe('ready');
  });

  it('matches the address regardless of case and spaces', () => {
    expect(view(invite({ email: 'Jane@Studio.com' }), ' jane@studio.COM ')).toBe('ready');
  });

  it('has nothing for an invitation that does not exist', () => {
    expect(view(null)).toBe('not_found');
    expect(view(invite({ status: 'mystery' }))).toBe('not_found');
  });

  it('says it is for a different account before it says anything else about the invitation', () => {
    expect(view(invite(), 'someone@else.com')).toBe('wrong_account');
    // Even a used, cancelled or expired invitation does not reveal its state to the wrong account.
    for (const over of [
      { status: 'accepted' },
      { status: 'canceled' },
      { status: 'rejected' },
      { expiresAt: inDays(-1) },
    ])
      expect(view(invite(over), 'someone@else.com'), JSON.stringify(over)).toBe('wrong_account');
  });

  it('tells apart expired, cancelled, declined and already used', () => {
    expect(view(invite({ expiresAt: inDays(-1) }))).toBe('expired');
    expect(view(invite({ expiresAt: now }))).toBe('expired');
    expect(view(invite({ status: 'canceled' }))).toBe('cancelled');
    expect(view(invite({ status: 'cancelled' }))).toBe('cancelled');
    expect(view(invite({ status: 'rejected' }))).toBe('declined');
    expect(view(invite({ status: 'accepted' }))).toBe('used');
  });

  it('recognises someone who is already in the organization', () => {
    expect(view(invite(), 'jane@studio.com', true)).toBe('already_member');
    expect(view(invite({ status: 'accepted' }), 'jane@studio.com', true)).toBe('already_member');
    // ...but an expired invitation is still just expired.
    expect(view(invite({ expiresAt: inDays(-2) }), 'jane@studio.com', true)).toBe('expired');
  });
});

describe('masking an address', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('jane.doe@studio.com')).toBe('j***@studio.com');
    expect(maskEmail('a@b.co')).toBe('a***@b.co');
  });

  it('does not choke on something that is not an address', () => {
    expect(maskEmail('')).toBe('***');
    expect(maskEmail('nonsense')).toBe('***');
    expect(maskEmail('@x.com')).toBe('***');
  });
});

describe('invitation ids', () => {
  it('accept Better Auth ids and refuse anything that could be a path or a query', () => {
    expect(isInvitationId('x3Kq9fT2vLm8Zp0aBcDeFgHiJkLmNoPq')).toBe(true);
    expect(isInvitationId('0b7c1d2e-3f40-4a51-8b62-73849a5b6c7d')).toBe(true);
    for (const bad of ['', 'short', '../etc/passwd', 'abc def ghi', 'a'.repeat(65), "x'; drop table--", 'ab/cdefgh'])
      expect(isInvitationId(bad), bad).toBe(false);
  });
});
