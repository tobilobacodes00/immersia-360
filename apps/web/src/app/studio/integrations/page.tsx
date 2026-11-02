import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { AlertCircle, CheckCircle2, Cloud, ExternalLink } from 'lucide-react';
import { Card, EmptyState, PageHeader, Pill, type PillTone } from '@immersia/ui';
import { formatRelative } from '@/lib/format';
import { roleCan } from '@/lib/permissions';
import { copyBacklog, loadIntegrations, recentCopies, type CopyView } from '@/server/cloud/integrations';
import { CLOUD_PROVIDERS, isCloudProvider } from '@/server/cloud/providers';
import { requireOperator } from '@/server/session';
import { IntegrationCard, type ProviderCardView } from './IntegrationCard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.integrations');
  return { title: t('title') };
}

/** The codes the OAuth callback can send back (see src/server/cloud/integrations.ts). */
const CONNECT_ERRORS = [
  'denied',
  'state',
  'scope',
  'no_refresh',
  'exchange',
  'unreachable',
  'unavailable',
  'forbidden',
  'failed',
] as const;
type ConnectErrorCode = (typeof CONNECT_ERRORS)[number];
const connectError = (v: string | undefined): ConnectErrorCode | null =>
  v === undefined ? null : (CONNECT_ERRORS.find((c) => c === v) ?? 'failed');

const STATUS_TONE: Record<CopyView['status'], PillTone> = {
  pending: 'neutral',
  uploading: 'info',
  done: 'ok',
  failed: 'bad',
};

/** Screen 20 (integrations): connect Google Drive and Dropbox, folder choice, status and re-auth (SHR-7, HLP-3). */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; provider?: string }>;
}) {
  const op = await requireOperator();
  const [t, locale, params, integrations, copies, backlogs] = await Promise.all([
    getTranslations('studio.integrations'),
    getLocale(),
    searchParams,
    loadIntegrations(op.organizationId),
    recentCopies(op.organizationId, 20),
    Promise.all(CLOUD_PROVIDERS.map((p) => copyBacklog(op.organizationId, p))),
  ]);
  const canManage = roleCan(op.role, { integration: ['connect'] });
  const cards: ProviderCardView[] = integrations.map((i, n) => ({
    id: i.provider,
    state: i.state,
    accountEmail: i.accountEmail,
    folderName: i.folderName,
    folderUrl: i.folderUrl,
    waiting: backlogs[n]?.waiting ?? 0,
    failed: backlogs[n]?.failed ?? 0,
    failedKey: backlogs[n]?.failedKey ?? null,
  }));

  const flashProvider = isCloudProvider(params.provider) ? t(`providers.${params.provider}`) : t('providers.generic');
  const connected = isCloudProvider(params.connected) ? params.connected : null;
  const error = connected ? null : connectError(params.error);

  /** What failed and what to do, for a copy that has not been delivered. */
  const note = (c: CopyView): string | null => {
    if (c.status === 'done' || !c.errorKey) return null;
    const provider = t(`providers.${c.provider}`);
    if (c.errorKey === 'transient' && c.status !== 'failed')
      return t('copyErrors.retrying', {
        provider,
        when: c.nextAttemptAt ? formatRelative(c.nextAttemptAt, locale) : t('copies.soon'),
      });
    return t(`copyErrors.${c.errorKey}`, { provider });
  };

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="space-y-6">
        {connected && (
          <div role="status" className="flex items-start gap-3 rounded-xl border border-ok/25 bg-ok/[0.07] p-4 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            <p>{t('flash.connected', { provider: t(`providers.${connected}`) })}</p>
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-bad/25 bg-bad/[0.05] p-4 text-sm"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
            <p>{t(`connectErrors.${error}`, { provider: flashProvider })}</p>
          </div>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-2">
          {cards.map((view) => (
            <IntegrationCard key={view.id} view={view} canManage={canManage} />
          ))}
        </div>

        <section aria-labelledby="copies-heading">
          <h2 id="copies-heading" className="eyebrow mb-1">
            {t('copies.title')}
          </h2>
          <p className="mb-3 text-[13px] text-muted">{t('copies.subtitle')}</p>
          <Card pad={false}>
            {copies.length === 0 ? (
              <EmptyState
                icon={<Cloud className="size-5" />}
                title={t('copies.emptyTitle')}
                body={t('copies.emptyBody')}
              />
            ) : (
              <ul className="divide-y divide-line">
                {copies.map((c) => {
                  const detail = note(c);
                  return (
                    <li key={c.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4 sm:px-6">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-[13px] font-medium">{c.fileName}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                          <Link href={`/studio/events/${c.eventId}`} className="focus-ring rounded hover:underline">
                            {c.eventName}
                          </Link>
                          <span aria-hidden>·</span>
                          <span>{t('copies.to', { provider: t(`providers.${c.provider}`) })}</span>
                          <span aria-hidden>·</span>
                          <time dateTime={(c.completedAt ?? c.createdAt).toISOString()}>
                            {formatRelative(c.completedAt ?? c.createdAt, locale)}
                          </time>
                        </div>
                        {detail && <p className="mt-1.5 text-[13px] leading-relaxed text-fg">{detail}</p>}
                      </div>
                      <div className="flex items-center gap-3">
                        {c.status === 'done' && c.remoteUrl && (
                          <a
                            href={c.remoteUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="focus-ring inline-flex items-center gap-1 rounded text-[13px] font-medium text-accent hover:underline"
                          >
                            {t('copies.open', { provider: t(`providers.${c.provider}`) })}
                            <ExternalLink className="size-3" aria-hidden />
                          </a>
                        )}
                        <Pill tone={STATUS_TONE[c.status]}>{t(`copies.status.${c.status}`)}</Pill>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </>
  );
}
