import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { AlertTriangle } from 'lucide-react';
import { Card, Stat, buttonClass } from '@immersia/ui';
import { formatBytes } from '@/lib/format';
import { roleCan } from '@/lib/permissions';
import { galleryUrl } from '@immersia/shared';
import { eventCloudAlert } from '@/server/cloud/integrations';
import { appOrigin } from '@/server/env';
import { eventStats, getEvent, guestFilesSummary } from '@/server/events';
import { galleryStats } from '@/server/gallery';
import { reportsForOrganization, type ReportItem } from '@/server/reports';
import { requireOperator } from '@/server/session';
import { ExtendGuestFiles } from './ExtendGuestFiles';
import { GalleryCard } from './GalleryCard';
import { ReportList } from '../../reports/ReportList';
import { toReportView } from '../../reports/views';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const op = await requireOperator();
  const event = await getEvent(op.organizationId, (await params).id);
  return { title: event?.name };
}

/** EVT-3 event dashboard: clip and photo count, render queue, upload status, storage used. */
export default async function EventDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const op = await requireOperator({ event: ['read'] });
  const [t, ti, locale, s, files, event, gallery, cloud, reports] = await Promise.all([
    getTranslations('studio.dashboard'),
    getTranslations('studio.integrations'),
    getLocale(),
    eventStats(op.organizationId, id),
    guestFilesSummary(op.organizationId, id),
    getEvent(op.organizationId, id),
    galleryStats(id),
    eventCloudAlert(op.organizationId, id),
    roleCan(op.role, { report: ['read'] })
      ? reportsForOrganization(op.organizationId, { eventId: id, limit: 50 })
      : Promise.resolve<ReportItem[]>([]),
  ]);
  const unresolved = reports.filter((r) => r.status === 'open' || r.status === 'escalated').length;
  const n = (v: number) => v.toLocaleString(locale);
  const cloudName = cloud ? ti(`providers.${cloud.provider}`) : '';
  return (
    <div className="space-y-6">
      {cloud && (
        // HLP-3: the event copies to the operator's own cloud and that needs them — what failed, what to do.
        <section
          aria-labelledby="cloud-heading"
          className="flex flex-wrap items-start gap-3 rounded-xl border border-warn/25 bg-warn/[0.07] p-4"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1">
            <h2 id="cloud-heading" className="text-sm font-semibold">
              {t('cloudTitle', { provider: cloudName })}
            </h2>
            {cloud.reason === 'needs_reauth' && (
              <p className="text-[13px] leading-relaxed text-muted">
                {t('cloudNeedsReauth', { provider: cloudName })}
                {cloud.waiting > 0 && ` ${t('cloudWaiting', { count: cloud.waiting })}`}
              </p>
            )}
            {cloud.reason === 'disconnected' && (
              <p className="text-[13px] leading-relaxed text-muted">
                {t('cloudDisconnected', { provider: cloudName })}
              </p>
            )}
            {cloud.failed > 0 && cloud.failedKey && (
              <p className="text-[13px] leading-relaxed text-muted">
                {t('cloudFailed', { count: cloud.failed, provider: cloudName })}{' '}
                {ti(`copyErrors.${cloud.failedKey}`, { provider: cloudName })}
              </p>
            )}
          </div>
          <Link href="/studio/integrations" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            {t('cloudFix')}
          </Link>
        </section>
      )}
      {reports.length > 0 && (
        // Abuse: guests reported something from this event. The operator can hide it right here.
        <Card
          id="reports"
          title={t('reportsTitle')}
          subtitle={unresolved > 0 ? t('reportsOpen', { count: unresolved }) : t('reportsSettled')}
        >
          <ReportList items={reports.map((r) => toReportView(r, locale))} />
        </Card>
      )}
      <section aria-labelledby="capture-heading">
        <h2 id="capture-heading" className="sr-only">
          {t('capture')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t('sessions')} value={n(s.sessions)} />
          <Stat label={t('videos')} value={n(s.videos)} />
          <Stat label={t('photos')} value={n(s.photos)} hint={s.gifs ? t('gifs', { count: s.gifs }) : undefined} />
          <Stat label={t('storage')} value={formatBytes(s.storageBytes, locale)} />
        </div>
      </section>
      <section aria-labelledby="pipeline-heading">
        <h2 id="pipeline-heading" className="eyebrow mb-3">
          {t('pipeline')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label={t('renderQueue')}
            value={n(s.renderQueue)}
            tone={s.renderQueue > 10 ? 'warn' : undefined}
            hint={t('renderQueueHint')}
          />
          <Stat
            label={t('uploads')}
            value={n(s.uploadsPending)}
            tone={s.uploadsPending > 0 ? 'warn' : 'ok'}
            hint={s.uploadsPending > 0 ? t('uploadsPending') : t('uploadsDone')}
          />
          <Stat label={t('devices')} value={n(s.activeDevices)} hint={t('devicesHint')} />
        </div>
      </section>
      <section aria-labelledby="files-heading">
        <h2 id="files-heading" className="eyebrow mb-3">
          {t('guestFiles')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label={t('liveLinks')} value={n(files.live)} />
          <Stat
            label={t('nextExpiry')}
            value={files.nextExpiry ? files.nextExpiry.toLocaleDateString(locale, { dateStyle: 'medium' }) : '—'}
          />
          <Stat label={t('removed')} value={n(files.removed)} hint={t('removedHint')} />
        </div>
        <ExtendGuestFiles eventId={id} live={files.live} />
      </section>
      {event && (
        <GalleryCard
          eventId={id}
          eventName={event.name}
          url={galleryUrl(appOrigin(), event.gallerySlug, 'direct')}
          items={gallery.items}
          locked={event.galleryPasswordHash !== null}
        />
      )}
    </div>
  );
}
