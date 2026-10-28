'use client';

import { useState, useTransition } from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, buttonClass } from '@immersia/ui';
import { authClient } from '@/lib/auth-client';
import type { InviteView } from '@/lib/invite-state';
import { isSingleRole } from '@/lib/team-rules';
import { acceptInvitationAction, declineInvitationAction } from '../actions';

/** The views that are only a message (no action to take) and the catalogue key that words each. */
const MESSAGE = {
  expired: 'expired',
  cancelled: 'cancelled',
  declined: 'declined',
  used: 'used',
  not_found: 'notFound',
  already_member: 'alreadyMember',
} as const;

export function InviteCard({
  id,
  view,
  signedIn,
  currentEmail,
  invitedEmail,
  organization,
  inviter,
  role,
}: {
  id: string;
  view: InviteView;
  signedIn: boolean;
  currentEmail: string;
  /** Masked: only for the "wrong account" view. */
  invitedEmail: string | null;
  organization: string | null;
  inviter: string | null;
  role: string | null;
}) {
  const t = useTranslations('invite');
  const tr = useTranslations('roles');
  const th = useTranslations('studio.team.roleHelp');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<'failed' | 'gone' | null>(null);

  const accept = () =>
    start(async () => {
      setError(null);
      const res = await acceptInvitationAction(id);
      if (res.ok) return router.replace('/studio');
      // Someone else may have changed it since the page loaded (cancelled, expired): show the truth.
      setError(res.error === 'conflict' || res.error === 'not_found' ? 'gone' : 'failed');
      if (res.error === 'conflict' || res.error === 'not_found') router.refresh();
    });

  const decline = () =>
    start(async () => {
      setError(null);
      const res = await declineInvitationAction(id);
      if (res.ok) return router.refresh();
      setError(res.error === 'conflict' || res.error === 'not_found' ? 'gone' : 'failed');
      if (res.error === 'conflict' || res.error === 'not_found') router.refresh();
    });

  const switchAccount = async () => {
    setSigningOut(true);
    await authClient.signOut();
    router.replace(`/sign-in?next=${encodeURIComponent(`/invite/${id}`)}` as Route);
    router.refresh();
  };

  const failure = error && (
    <p role="alert" className="mt-4 text-sm text-bad">
      {t(`errors.${error}`)}
    </p>
  );

  if (view === 'ready' && organization) {
    const roleName = role && isSingleRole(role) ? role : null;
    return (
      <div>
        <div className="eyebrow mb-3">{t('eyebrow')}</div>
        <h1 className="text-[30px] leading-[1.05] font-bold tracking-[-0.03em]">{t('readyTitle', { organization })}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          {t('readyBody', {
            inviter: inviter ?? '',
            organization,
            role: roleName ? tr(roleName) : (role ?? ''),
          })}
        </p>
        {roleName && (
          <p className="mt-4 rounded-xl bg-sunken p-4 text-[13px] leading-relaxed text-muted">{th(roleName)}</p>
        )}
        <p className="mt-4 text-[13px] text-faint">{t('signedInAs', { email: currentEmail })}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="primary" size="lg" disabled={pending} onClick={accept}>
            {pending ? t('accepting') : t('accept')}
          </Button>
          <Button variant="ghost" size="lg" disabled={pending} onClick={decline}>
            {t('decline')}
          </Button>
        </div>
        {failure}
      </div>
    );
  }

  if (view === 'wrong_account') {
    return (
      <div>
        <div className="eyebrow mb-3">{t('eyebrow')}</div>
        <h1 className="text-[30px] leading-[1.05] font-bold tracking-[-0.03em]">{t('wrongAccount.title')}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          {t('wrongAccount.body', { invited: invitedEmail ?? '', current: currentEmail })}
        </p>
        <div className="mt-6">
          <Button variant="primary" size="lg" disabled={signingOut} onClick={switchAccount}>
            {signingOut ? t('wrongAccount.signingOut') : t('wrongAccount.signOut')}
          </Button>
        </div>
      </div>
    );
  }

  // Everything else is a message. (`ready` without an organization cannot happen; it reads as not found.)
  const key = MESSAGE[view === 'ready' ? 'not_found' : view];
  return (
    <div>
      <div className="eyebrow mb-3">{t('eyebrow')}</div>
      <h1 className="text-[30px] leading-[1.05] font-bold tracking-[-0.03em]">{t(`${key}.title`)}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        {key === 'alreadyMember' ? t('alreadyMember.body', { organization: organization ?? '' }) : t(`${key}.body`)}
      </p>
      {signedIn && (
        <div className="mt-6">
          {view === 'already_member' ? (
            <Button variant="primary" size="lg" disabled={pending} onClick={accept}>
              {t('openStudio')}
            </Button>
          ) : (
            <Link href="/studio" className={buttonClass({ variant: 'primary', size: 'lg' })}>
              {t('openStudio')}
            </Link>
          )}
        </div>
      )}
      {failure}
    </div>
  );
}
