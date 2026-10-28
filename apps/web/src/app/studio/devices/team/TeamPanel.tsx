'use client';

import { useCallback, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, type Messages } from 'next-intl';
import { AlertCircle, CheckCircle2, LogOut } from 'lucide-react';
import { Button, Card, Modal, Pill, Select, TextInput, useHydrated } from '@immersia/ui';
import { roleCan, type RoleName } from '@/lib/permissions';
import { ASSIGNABLE_ROLES, isSingleRole, memberCapabilities } from '@/lib/team-rules';
import type { ActionResult } from '@/server/action-result';
import {
  changeMemberRoleAction,
  inviteMemberAction,
  leaveOrganizationAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
} from '../team-actions';

export interface MemberItem {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  /** Already formatted for the viewer's language. */
  joined: string;
}

export interface InvitationItem {
  id: string;
  email: string;
  role: string;
  invitedBy: string;
  expired: boolean;
  /** "in 6 days", already in the viewer's language. */
  expires: string;
}

type ErrorKey = keyof Messages['studio']['team']['errors'];

const ERROR_KEYS = new Set<ErrorKey>([
  'forbidden',
  'invalid_email',
  'invalid_role',
  'last_owner',
  'only_organization',
  'already_member',
  'invitation_limit',
  'membership_limit',
  'rate_limited',
  'not_found',
  'failed',
]);
const isErrorKey = (value: string | undefined): value is ErrorKey => ERROR_KEYS.has(value as ErrorKey);

/** The action's first issue code (or its error class) as wording that says what happened. */
function errorKeyFor(res: { error: string; issues?: string[] }): ErrorKey {
  const issue = res.issues?.[0];
  if (issue === 'not_a_member') return 'not_found';
  if (isErrorKey(issue)) return issue;
  if (res.error === 'unauthenticated') return 'forbidden';
  return isErrorKey(res.error) ? res.error : 'failed';
}

const displayName = (m: { name: string; email: string }) => m.name.trim() || m.email;
const initial = (name: string) => name.trim().slice(0, 1).toUpperCase() || '?';

export function TeamPanel({
  organizationName,
  me,
  members,
  invitations,
  organizationCount,
}: {
  organizationName: string;
  me: { userId: string; role: RoleName };
  members: MemberItem[];
  /** Null for roles that cannot invite: they do not see the invitations at all. */
  invitations: InvitationItem[] | null;
  organizationCount: number;
}) {
  const t = useTranslations('studio.team');
  const tr = useTranslations('roles');
  const router = useRouter();
  const hydrated = useHydrated();
  const emailId = useId();
  const roleId = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<ErrorKey | null>(null);
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<RoleName>('viewer');
  // The role just picked for a member, shown until the server has answered.
  const [chosen, setChosen] = useState<Record<string, RoleName>>({});
  const [removing, setRemoving] = useState<MemberItem | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [demoting, setDemoting] = useState<{ member: MemberItem; role: RoleName } | null>(null);
  const closeRemove = useCallback(() => setRemoving(null), []);
  const closeLeave = useCallback(() => setLeaving(false), []);
  const closeDemote = useCallback(() => setDemoting(null), []);

  const canManage = roleCan(me.role, { member: ['update'] });
  const roster = members.map((m) => ({ memberId: m.memberId, userId: m.userId, role: m.role }));
  const roleOptions = ASSIGNABLE_ROLES.map((r) => ({ value: r, label: tr(r) }));

  /** Run an action, report what happened, and let the caller do the rest on success. */
  const run = (action: () => Promise<ActionResult<unknown>>, onOk: () => void) =>
    start(async () => {
      setError(null);
      setNotice('');
      const res = await action();
      if (!res.ok) return setError(errorKeyFor(res));
      onOk();
    });

  const applyRole = (member: MemberItem, role: RoleName) =>
    start(async () => {
      setError(null);
      setNotice('');
      setChosen((c) => ({ ...c, [member.memberId]: role }));
      const res = await changeMemberRoleAction({ memberId: member.memberId, role });
      setChosen((c) => {
        const rest = { ...c };
        delete rest[member.memberId];
        return rest;
      });
      setDemoting(null);
      if (!res.ok) return setError(errorKeyFor(res));
      setNotice(t('members.roleChanged', { name: displayName(member), role: tr(role) }));
    });

  const changeRole = (member: MemberItem, role: RoleName) => {
    // Stepping down from owner is the one change that locks you out of undoing it: confirm first.
    if (member.userId === me.userId && member.role === 'owner' && role !== 'owner') setDemoting({ member, role });
    else applyRole(member, role);
  };

  const renderMember = (m: MemberItem) => {
    const caps = memberCapabilities({
      actorUserId: me.userId,
      actorRole: me.role,
      roster,
      member: { memberId: m.memberId, userId: m.userId, role: m.role },
      organizationCount,
    });
    const name = displayName(m);
    const current = chosen[m.memberId] ?? (isSingleRole(m.role) ? m.role : null);
    const hintId = `leave-hint-${m.memberId}`;
    const hint =
      caps.self && caps.blockedBy === 'last_owner'
        ? t('members.soleOwner')
        : caps.self && caps.blockedBy === 'only_organization'
          ? t('members.onlyOrganization')
          : null;
    return (
      <li key={m.memberId} className="px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-[13px] font-semibold text-muted"
          >
            {initial(name)}
          </span>
          <div className="min-w-0 flex-1 basis-52">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{name}</span>
              {caps.self && <Pill tone="info">{t('members.you')}</Pill>}
            </div>
            <div className="truncate text-[13px] text-muted">
              {m.email} · {t('members.joined', { date: m.joined })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {caps.canChangeRole && current ? (
              <Select<RoleName>
                label={t('members.roleFor', { name })}
                value={current}
                options={roleOptions}
                disabled={pending}
                onChange={(role) => changeRole(m, role)}
                className="w-36"
              />
            ) : (
              <Pill tone={m.role === 'owner' ? 'accent' : 'neutral'}>{isSingleRole(m.role) ? tr(m.role) : m.role}</Pill>
            )}
            {caps.canRemove && (
              <Button
                size="sm"
                variant="danger"
                aria-label={t('members.removeLabel', { name })}
                onClick={() => setRemoving(m)}
              >
                {t('members.remove')}
              </Button>
            )}
            {caps.self && (
              <Button
                size="sm"
                variant="danger"
                disabled={!caps.canLeave || pending}
                aria-describedby={hint ? hintId : undefined}
                icon={<LogOut className="size-3.5" aria-hidden />}
                onClick={() => setLeaving(true)}
              >
                {t('members.leave')}
              </Button>
            )}
          </div>
        </div>
        {hint && (
          <p id={hintId} className="mt-2 text-[13px] leading-relaxed text-muted sm:pl-[3.25rem]">
            {hint}
          </p>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-8">
      <div role="status" aria-live="polite">
        {notice && (
          <p className="flex items-start gap-3 rounded-xl border border-ok/25 bg-ok/[0.07] p-4 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            {notice}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-3 rounded-xl border border-bad/25 bg-bad/[0.05] p-4 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
          {t(`errors.${error}`)}
        </p>
      )}

      <section aria-labelledby="members-heading">
        <h2 id="members-heading" className="eyebrow mb-1">
          {t('members.title')}
        </h2>
        <p className="mb-3 text-[13px] text-muted">
          {canManage
            ? t('members.subtitle', { organization: organizationName })
            : t('members.subtitleReadOnly', { organization: organizationName })}
        </p>
        <Card pad={false}>
          <ul className="divide-y divide-line">{members.map(renderMember)}</ul>
        </Card>
      </section>

      {invitations && (
        <>
          <section aria-labelledby="invite-heading">
            <h2 id="invite-heading" className="eyebrow mb-1">
              {t('invite.title')}
            </h2>
            <p className="mb-3 text-[13px] text-muted">{t('invite.subtitle')}</p>
            <Card pad={false}>
              <form
                className="grid gap-4 px-5 py-5 sm:grid-cols-[1fr_12rem_auto] sm:items-end sm:px-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  const address = email.trim();
                  if (!address) return;
                  run(
                    () => inviteMemberAction({ email: address, role: inviteRole }),
                    () => {
                      setEmail('');
                      setNotice(t('invite.sent', { email: address }));
                    },
                  );
                }}
              >
                <div className="space-y-2">
                  <label htmlFor={emailId} className="text-sm font-medium">
                    {t('invite.email')}
                  </label>
                  <TextInput
                    id={emailId}
                    name="email"
                    type="email"
                    autoComplete="off"
                    required
                    value={email}
                    onChange={setEmail}
                    placeholder={t('invite.emailPlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor={roleId} className="text-sm font-medium">
                    {t('invite.role')}
                  </label>
                  <Select<RoleName> id={roleId} value={inviteRole} options={roleOptions} onChange={setInviteRole} />
                </div>
                <Button type="submit" variant="primary" disabled={!hydrated || pending || !email.trim()}>
                  {pending ? t('invite.sending') : t('invite.send')}
                </Button>
                <p className="text-[13px] leading-relaxed text-muted sm:col-span-3">{t(`roleHelp.${inviteRole}`)}</p>
              </form>
            </Card>
          </section>

          <section aria-labelledby="pending-heading">
            <h2 id="pending-heading" className="eyebrow mb-1">
              {t('pending.title')}
            </h2>
            <p className="mb-3 text-[13px] text-muted">{t('pending.subtitle')}</p>
            <Card pad={false}>
              {invitations.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted sm:px-6">{t('pending.empty')}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {invitations.map((inv) => (
                    <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:px-6">
                      <div className="min-w-0 flex-1 basis-52">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">{inv.email}</span>
                          <Pill tone={inv.role === 'owner' ? 'accent' : 'neutral'}>
                            {isSingleRole(inv.role) ? tr(inv.role) : inv.role}
                          </Pill>
                          {inv.expired && <Pill tone="warn">{t('pending.expired')}</Pill>}
                        </div>
                        <div className="truncate text-[13px] text-muted">
                          {t('pending.invitedBy', { name: inv.invitedBy })}
                          {!inv.expired && <> · {t('pending.expires', { when: inv.expires })}</>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          disabled={pending}
                          aria-label={t('pending.resendLabel', { email: inv.email })}
                          onClick={() =>
                            run(
                              () => resendInvitationAction(inv.id),
                              () => setNotice(t('pending.resent', { email: inv.email })),
                            )
                          }
                        >
                          {t('pending.resend')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={pending}
                          aria-label={t('pending.revokeLabel', { email: inv.email })}
                          onClick={() =>
                            run(
                              () => revokeInvitationAction(inv.id),
                              () => setNotice(t('pending.revoked', { email: inv.email })),
                            )
                          }
                        >
                          {t('pending.revoke')}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </>
      )}

      <Modal
        open={Boolean(removing)}
        onClose={closeRemove}
        title={t('confirm.removeTitle', { name: removing ? displayName(removing) : '' })}
      >
        <div className="space-y-4 p-6">
          <p className="text-sm leading-relaxed text-muted">
            {t('confirm.removeBody', { organization: organizationName })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeRemove}>
              {t('confirm.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                const target = removing;
                if (!target) return;
                run(
                  () => removeMemberAction(target.memberId),
                  () => {
                    setRemoving(null);
                    setNotice(t('members.removed', { name: displayName(target) }));
                  },
                );
              }}
            >
              {t('confirm.remove')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={leaving} onClose={closeLeave} title={t('confirm.leaveTitle', { organization: organizationName })}>
        <div className="space-y-4 p-6">
          <p className="text-sm leading-relaxed text-muted">{t('confirm.leaveBody')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeLeave}>
              {t('confirm.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                run(
                  () => leaveOrganizationAction(),
                  () => {
                    setLeaving(false);
                    router.replace('/studio');
                  },
                )
              }
            >
              {t('confirm.leave')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(demoting)} onClose={closeDemote} title={t('confirm.demoteTitle')}>
        <div className="space-y-4 p-6">
          <p className="text-sm leading-relaxed text-muted">
            {t('confirm.demoteBody', { role: demoting ? tr(demoting.role) : '' })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeDemote}>
              {t('confirm.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                if (demoting) applyRole(demoting.member, demoting.role);
              }}
            >
              {t('confirm.demote')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
