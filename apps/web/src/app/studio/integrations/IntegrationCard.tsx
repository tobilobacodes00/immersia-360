'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useTranslations, type Messages } from 'next-intl';
import { AlertTriangle, ExternalLink, HardDrive, Package } from 'lucide-react';
import { Button, Modal, Pill, TextInput, buttonClass, type PillTone } from '@immersia/ui';
import type { CopyErrorKey } from '@/server/cloud/copy-core';
import type { CloudProviderId, IntegrationState } from '@/server/cloud/types';
import { chooseFolderAction, disconnectIntegrationAction, retryCopiesAction } from '../integration-actions';

export interface ProviderCardView {
  id: CloudProviderId;
  state: IntegrationState;
  accountEmail: string | null;
  folderName: string | null;
  folderUrl: string | null;
  /** Copies still to do, and copies that failed (with the reason most share). */
  waiting: number;
  failed: number;
  failedKey: CopyErrorKey | null;
}

type ActionErrorKey = keyof Messages['studio']['integrations']['actionErrors'];

/** The action's `issues[0]` (or its error) as wording that says what failed and what to do. */
const actionErrorKey = (code: string | undefined): ActionErrorKey =>
  code === 'reauth_required' || code === 'quota_exceeded' || code === 'unreachable' || code === 'forbidden'
    ? code
    : 'failed';

const ICON = { drive: HardDrive, dropbox: Package } as const;

const TONE: Record<IntegrationState, PillTone> = {
  unavailable: 'neutral',
  disconnected: 'neutral',
  connected: 'ok',
  needs_reauth: 'warn',
};

const STATUS_KEY = {
  unavailable: 'notConfigured',
  disconnected: 'notConnected',
  connected: 'connected',
  needs_reauth: 'needsReauth',
} as const;

/** A notice that says what went wrong and what to do about it (HLP-3). */
function Notice({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-warn/25 bg-warn/[0.07] p-4">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        <div className="mt-1 text-[13px] leading-relaxed text-muted">{children}</div>
      </div>
      {action}
    </div>
  );
}

export function IntegrationCard({ view, canManage }: { view: ProviderCardView; canManage: boolean }) {
  const t = useTranslations('studio.integrations');
  const [pending, start] = useTransition();
  const [error, setError] = useState<ActionErrorKey | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [folder, setFolder] = useState(view.folderName ?? t('folder.placeholder'));
  const Icon = ICON[view.id];
  const provider = t(`providers.${view.id}`);
  const connectHref = `/api/integrations/${view.id}/connect`;

  const run = (action: () => Promise<{ ok: boolean; issues?: string[] }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await action();
      if (!res.ok) return setError(actionErrorKey(res.issues?.[0]));
      after?.();
    });

  const reconnect = (
    <a href={connectHref} className={buttonClass({ variant: 'primary', size: 'sm' })}>
      {t('reconnect', { provider })}
    </a>
  );

  return (
    <section aria-labelledby={`integration-${view.id}`} className="card">
      <header className="flex flex-wrap items-start gap-4 border-b border-line px-5 py-4 sm:px-6">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sunken text-muted">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`integration-${view.id}`} className="text-[15px] font-semibold tracking-[-0.01em]">
            {provider}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{t(`about.${view.id}`)}</p>
        </div>
        <Pill tone={TONE[view.state]} dot={view.state === 'connected'}>
          {t(`status.${STATUS_KEY[view.state]}`)}
        </Pill>
      </header>

      <div className="space-y-4 px-5 py-5 sm:px-6">
        {view.state === 'unavailable' && <p className="text-sm text-muted">{t('notConfigured', { provider })}</p>}

        {view.state === 'disconnected' &&
          (canManage ? (
            <a href={connectHref} className={buttonClass({ variant: 'primary' })}>
              {t('connect', { provider })}
            </a>
          ) : (
            <p className="text-sm text-muted">{t('ownerOnly')}</p>
          ))}

        {view.state === 'needs_reauth' && (
          <Notice title={t('reauth.title', { provider })} action={canManage ? reconnect : undefined}>
            <p>{t('reauth.body', { provider })}</p>
            {view.waiting > 0 && <p className="mt-1">{t('reauth.waiting', { count: view.waiting })}</p>}
          </Notice>
        )}

        {(view.state === 'connected' || view.state === 'needs_reauth') && (
          <>
            {view.accountEmail && <p className="text-sm">{t('connectedAs', { email: view.accountEmail })}</p>}

            {view.state === 'connected' && view.failed > 0 && view.failedKey && (
              <Notice
                title={t('failed.title', { count: view.failed, provider })}
                action={
                  canManage ? (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={pending}
                      onClick={() => run(() => retryCopiesAction(view.id))}
                    >
                      {pending ? t('failed.retrying') : t('failed.retry')}
                    </Button>
                  ) : undefined
                }
              >
                <p>{t(`copyErrors.${view.failedKey}`, { provider })}</p>
              </Notice>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">{t('folder.label')}</span>
                {view.folderName ? (
                  <span className="text-muted">{view.folderName}</span>
                ) : (
                  <span className="text-muted">{t('folder.none')}</span>
                )}
                {view.folderUrl && (
                  <a
                    href={view.folderUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="focus-ring inline-flex items-center gap-1 rounded text-[13px] font-medium text-accent hover:underline"
                  >
                    {t('folder.open')}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </div>
              <p className="text-[13px] leading-relaxed text-faint">{t('folder.help')}</p>
              {canManage && view.state === 'connected' && (
                <form
                  className="flex flex-wrap items-end gap-2 pt-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => chooseFolderAction(view.id, folder));
                  }}
                >
                  <label className="block space-y-1.5">
                    <span className="text-[13px] font-medium">{t('folder.name')}</span>
                    <TextInput
                      value={folder}
                      onChange={setFolder}
                      required
                      placeholder={t('folder.placeholder')}
                      className="w-64 max-w-full"
                    />
                  </label>
                  <Button type="submit" variant="secondary" disabled={pending || !folder.trim()}>
                    {t('folder.save')}
                  </Button>
                </form>
              )}
            </div>

            {error && !confirming && (
              <p role="alert" className="text-sm text-bad">
                {t(`actionErrors.${error}`, { provider })}
              </p>
            )}

            {canManage ? (
              <div className="border-t border-line pt-4">
                <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
                  {t('disconnect.button')}
                </Button>
              </div>
            ) : (
              <p className="border-t border-line pt-4 text-[13px] text-faint">{t('ownerOnly')}</p>
            )}
          </>
        )}
      </div>

      <Modal open={confirming} onClose={() => setConfirming(false)} title={t('disconnect.title', { provider })}>
        <div className="space-y-4 p-6">
          <p className="text-sm leading-relaxed text-muted">{t('disconnect.body', { provider })}</p>
          {error && (
            <p role="alert" className="text-sm text-bad">
              {t(`actionErrors.${error}`, { provider })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('disconnect.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                run(
                  () => disconnectIntegrationAction(view.id),
                  () => setConfirming(false),
                )
              }
            >
              {t('disconnect.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
