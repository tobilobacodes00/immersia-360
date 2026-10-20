import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { CheckCircle2, CircleX, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { Locale } from '@immersia/i18n';
import { PageHeader, Pill, buttonClass, type PillTone } from '@immersia/ui';
import { PublicShell } from '@/components/PublicShell';
import { SUPPORT_RESPONSE_BUSINESS_DAYS } from '@/lib/support';
import { INCIDENT_WINDOW_DAYS, loadIncidents, recentIncidents, type Incident } from '@/lib/status/incidents';
import type { Overall, ServiceState } from '@/lib/status/services';
import { supportEmail } from '@/server/env';
import { STATUS_CACHE_S, getStatus } from '@/server/status';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('status');
  return { title: t('metaTitle'), description: t('subtitle') };
}

const OVERALL: Record<Overall, { Icon: LucideIcon; box: string; icon: string }> = {
  operational: { Icon: CheckCircle2, box: 'border-ok/25 bg-ok/[0.07]', icon: 'text-ok' },
  degraded: { Icon: TriangleAlert, box: 'border-warn/30 bg-warn/[0.08]', icon: 'text-warn' },
  outage: { Icon: CircleX, box: 'border-bad/25 bg-bad/[0.05]', icon: 'text-bad' },
};

const TONE: Record<ServiceState, PillTone> = {
  operational: 'ok',
  degraded: 'warn',
  down: 'bad',
  not_configured: 'neutral',
};

const IMPACT_TONE: Record<Incident['impact'], PillTone> = { minor: 'warn', major: 'bad', maintenance: 'info' };

/** Never a stale answer: this page is the one people open when something is wrong. */
export const dynamic = 'force-dynamic';

/** HLP-4: the public status page. Live checks of our own dependencies, recent incidents, and how to reach us. */
export default async function StatusPage() {
  const locale = (await getLocale()) as Locale;
  const [t, report, incidents] = await Promise.all([
    getTranslations('status'),
    getStatus(),
    // A missing or broken incidents file must not take the status page down with it.
    loadIncidents().catch((err: unknown) => {
      console.error('[status] incidents file', err instanceof Error ? err.message : err);
      return [] as Incident[];
    }),
  ]);
  const { Icon, box, icon } = OVERALL[report.overall];
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' });
  const list = recentIncidents(incidents, new Date(report.checkedAt));
  const anyUnused = report.services.some((s) => s.state === 'not_configured');
  // A misconfigured server (the very thing this page may be reporting) must not stop it rendering.
  const email = (() => {
    try {
      return supportEmail();
    } catch {
      return null;
    }
  })();

  return (
    <PublicShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div role="status" className={`flex items-center gap-4 rounded-2xl border p-5 sm:p-6 ${box}`}>
        <Icon className={`size-8 shrink-0 ${icon}`} aria-hidden />
        <div>
          <p className="text-xl font-bold tracking-[-0.02em]">{t(`overall.${report.overall}`)}</p>
          <p className="mt-0.5 text-[13px] text-muted">
            {t('checked', { time: when.format(new Date(report.checkedAt)), seconds: STATUS_CACHE_S })}
          </p>
        </div>
      </div>

      <section aria-labelledby="status-services" className="mt-10">
        <h2 id="status-services" className="text-[22px] font-bold tracking-[-0.02em]">
          {t('servicesTitle')}
        </h2>
        <ul className="card mt-4 divide-y divide-line">
          {report.services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 sm:px-6">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{t(`services.${s.id}.name`)}</p>
                <p className="mt-0.5 text-[13px] text-muted">{t(`services.${s.id}.description`)}</p>
              </div>
              {s.ms !== null && s.state !== 'down' && (
                <span className="tabular text-[13px] text-faint">{t('responded', { ms: s.ms })}</span>
              )}
              <Pill tone={TONE[s.state]} dot={s.state === 'operational'}>
                {t(`state.${s.state}`)}
              </Pill>
            </li>
          ))}
        </ul>
        {anyUnused && <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-faint">{t('notConfigured')}</p>}
      </section>

      <section aria-labelledby="status-incidents" className="mt-10">
        <h2 id="status-incidents" className="text-[22px] font-bold tracking-[-0.02em]">
          {t('incidentsTitle')}
        </h2>
        {list.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('noIncidents', { days: INCIDENT_WINDOW_DAYS })}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {list.map((i) => (
              <li key={i.id} className="card px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="text-[15px] font-semibold">{i.title[locale]}</h3>
                  <Pill tone={IMPACT_TONE[i.impact]}>{t(`impact.${i.impact}`)}</Pill>
                  <Pill tone={i.resolvedAt ? 'ok' : 'warn'}>
                    {i.resolvedAt ? t('resolved', { date: day.format(new Date(i.resolvedAt)) }) : t('ongoing')}
                  </Pill>
                </div>
                <p className="mt-1 text-[13px] text-faint">
                  {t('started', { date: day.format(new Date(i.startedAt)) })}
                </p>
                <p className="mt-2 text-sm leading-relaxed">{i.body[locale]}</p>
                {i.services.length > 0 && (
                  <p className="mt-2 text-[13px] text-muted">
                    {t('affected', { services: i.services.map((s) => t(`services.${s}.name`)).join(', ') })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="status-support" className="mt-10">
        <div className="card flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div className="min-w-0">
            <h2 id="status-support" className="text-[15px] font-semibold">
              {t('supportTitle')}
            </h2>
            {email && (
              <p className="mt-0.5 text-sm text-muted">
                {t('supportBody', { email, days: SUPPORT_RESPONSE_BUSINESS_DAYS })}
              </p>
            )}
          </div>
          <Link href="/help" className={buttonClass()}>
            {t('helpLink')}
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
