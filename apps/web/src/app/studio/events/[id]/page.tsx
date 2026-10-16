import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Stat } from '@immersia/ui';
import { formatBytes } from '@/lib/format';
import { eventStats, getEvent } from '@/server/events';
import { requireOperator } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const op = await requireOperator();
  const event = await getEvent(op.organizationId, (await params).id);
  return { title: event?.name };
}

/** EVT-3 event dashboard: clip and photo count, render queue, upload status, storage used. */
export default async function EventDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const op = await requireOperator({ event: ['read'] });
  const [t, locale, s] = await Promise.all([
    getTranslations('studio.dashboard'),
    getLocale(),
    eventStats(op.organizationId, id),
  ]);
  const n = (v: number) => v.toLocaleString(locale);
  return (
    <div className="space-y-6">
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
    </div>
  );
}
