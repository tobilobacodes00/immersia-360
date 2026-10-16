import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowRight, Images, RotateCw } from 'lucide-react';
import { Card, EmptyState, PageHeader, Pill } from '@immersia/ui';
import { formatEventDate } from '@/lib/format';
import { roleCan } from '@/lib/permissions';
import { recentEvents } from '@/server/events';
import { requireOperator } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.launcher');
  return { title: t('title') };
}

/** Screen 2: mode launcher — two large cards, then recent events. */
export default async function LauncherPage() {
  const op = await requireOperator();
  const [t, te, locale, recent] = await Promise.all([
    getTranslations('studio.launcher'),
    getTranslations('studio.events'),
    getLocale(),
    recentEvents(op.organizationId),
  ]);
  const canCreate = roleCan(op.role, { event: ['create'] });
  const modes = [
    { mode: 'video360' as const, icon: RotateCw, title: t('video360.title'), body: t('video360.body') },
    { mode: 'photo' as const, icon: Images, title: t('photo.title'), body: t('photo.body') },
  ];
  return (
    <>
      <PageHeader eyebrow={op.organizationName} title={t('title')} subtitle={t('subtitle')} />
      <div className="grid gap-4 sm:grid-cols-2">
        {modes.map(({ mode, icon: Icon, title, body }) => {
          const content = (
            <>
              <span className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
                <Icon className="size-6" aria-hidden />
              </span>
              <h2 className="mt-6 text-2xl font-bold tracking-[-0.03em]">{title}</h2>
              <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-muted">{body}</p>
              {canCreate && (
                <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
                  {t('newEvent')} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              )}
            </>
          );
          return canCreate ? (
            <Link
              key={mode}
              href={{ pathname: '/studio/events/new', query: { mode } }}
              className="group card focus-ring block p-7 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-pop sm:p-8"
            >
              {content}
            </Link>
          ) : (
            <div key={mode} className="card p-7 sm:p-8">
              {content}
            </div>
          );
        })}
      </div>

      <Card
        className="mt-8"
        title={t('recent')}
        action={
          <Link href="/studio/events" className="text-[13px] font-semibold text-accent hover:underline">
            {t('allEvents')}
          </Link>
        }
        pad={false}
      >
        {recent.length === 0 ? (
          <EmptyState icon={<RotateCw className="size-5" />} title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/studio/events/${e.id}`}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-sunken/60 sm:px-6"
                >
                  {e.mode === 'video360' ? (
                    <RotateCw className="size-4 shrink-0 text-faint" aria-hidden />
                  ) : (
                    <Images className="size-4 shrink-0 text-faint" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.name}</span>
                  {e.status === 'live' && (
                    <Pill tone="ok" dot>
                      {te('status.live')}
                    </Pill>
                  )}
                  <span className="text-[13px] whitespace-nowrap text-muted">{formatEventDate(e.date, locale)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
