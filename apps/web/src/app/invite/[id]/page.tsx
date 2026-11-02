import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BrandMark } from '@immersia/ui';
import { LanguagePicker } from '@/components/LanguagePicker';
import { isInvitationId, maskEmail } from '@/lib/invite-state';
import { getSession } from '@/server/session';
import { resolveInvite } from '@/server/team-data';
import { InviteCard } from './InviteCard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('invite');
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * ACC-3, the invitee's side: who invited you, to which organization, as what. Signed-out visitors
 * go to sign-in and come back here; the invitation only opens for the address it was sent to, and
 * for any other account the page says so without revealing the organization.
 */
export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    // A malformed id cannot be an invitation: no point sending anyone through sign-in for it.
    if (isInvitationId(id)) redirect(`/sign-in?next=${encodeURIComponent(`/invite/${id}`)}` as Route);
  }
  const user = session ? { id: session.user.id, email: session.user.email } : { id: '', email: '' };
  const { facts, view } = session ? await resolveInvite(id, user) : { facts: null, view: 'not_found' as const };
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="grid flex-1 place-items-center px-4 py-12">
        <div className="w-full max-w-md">
          <BrandMark size={40} className="mb-8" />
          <InviteCard
            id={id}
            view={view}
            signedIn={Boolean(session)}
            currentEmail={user.email}
            invitedEmail={view === 'wrong_account' && facts ? maskEmail(facts.email) : null}
            organization={view === 'wrong_account' ? null : (facts?.organizationName ?? null)}
            inviter={view === 'wrong_account' ? null : facts?.inviterName || facts?.inviterEmail || null}
            role={view === 'wrong_account' ? null : (facts?.role ?? null)}
          />
        </div>
      </main>
      <footer className="flex items-center justify-center gap-3 px-4 py-6">
        <LanguagePicker className="w-40" />
      </footer>
    </div>
  );
}
