import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { HelpLink } from '@/components/HelpLink';
import { HELP_ARTICLES } from '@/lib/help-links';
import { roleCan } from '@/lib/permissions';
import { requireOperator } from '@/server/session';
import { expiryOf, listMembers, listPendingInvitations, organizationsOf } from '@/server/team-data';
import { TeamPanel, type InvitationItem, type MemberItem } from './TeamPanel';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.team');
  return { title: t('title') };
}

/**
 * Screen 21, team section (ACC-3): members with their roles, and for owners the invitations. Every
 * role can see the team; only owners get the controls (and the server checks each action again).
 */
export default async function TeamPage() {
  const op = await requireOperator();
  const [locale, th] = await Promise.all([getLocale(), getTranslations('help.links')]);
  const canInvite = roleCan(op.role, { invitation: ['create'] });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const [members, invitations, organizations] = await Promise.all([
    listMembers(op.organizationId),
    canInvite ? listPendingInvitations(op.organizationId) : Promise.resolve(null),
    organizationsOf(op.userId),
  ]);
  const memberItems: MemberItem[] = members.map((m) => ({
    memberId: m.memberId,
    userId: m.userId,
    name: m.name,
    email: m.email,
    role: m.role,
    joined: date.format(m.joinedAt),
  }));
  const invitationItems: InvitationItem[] | null =
    invitations?.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      invitedBy: i.invitedBy,
      ...expiryOf(i.expiresAt, locale),
    })) ?? null;
  return (
    <>
      <div className="mb-4">
        <HelpLink slug={HELP_ARTICLES.roles} label={th('roles')} />
      </div>
      <TeamPanel
        organizationName={op.organizationName}
        me={{ userId: op.userId, role: op.role }}
        members={memberItems}
        invitations={invitationItems}
        organizationCount={organizations.length}
      />
    </>
  );
}
