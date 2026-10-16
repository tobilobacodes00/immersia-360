import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { CalendarDays, Images, Plus, RotateCw } from 'lucide-react';
import { EmptyState, PageHeader, Pill, buttonClass } from '@immersia/ui';
import { formatBytes, formatEventDate } from '@/lib/format';
import { roleCan } from '@/lib/permissions';
import { listEvents, type BoothMode } from '@/server/events';
import { requireOperator } from '@/server/session';
import { EventFilters } from './EventFilters';
import { EventRowActions } from './EventRowActions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.events');
  return { title: t('title') };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Screen 3: search, filter by mode and date, duplicate, archive, storage per event. */
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mode?: string; from?: string; to?: string; archived?: string }>;
}) {
  const op = await requireOperator();
  const sp = await searchParams;
  const filters = {
    q: sp.q?.trim().slice(0, 100) || undefined,
    mode: sp.mode === 'video360' || sp.mode === 'photo' ? (sp.mode as BoothMode) : undefined,
    from: sp.from && DATE_RE.test(sp.from) ? sp.from : undefined,
    to: sp.to && DATE_RE.test(sp.to) ? sp.to : undefined,
    archived: sp.archived === '1',
  };
  const [t, locale, events] = await Promise.all([
    getTranslations('studio.events'),
    getLocale(),
    listEvents(op.organizationId, filters),
  ]);
  const canCreate = roleCan(op.role, { event: ['create'] });
  const filtered = Boolean(filters.q || filters.mode || filters.from || filters.to);

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          canCreate && (
            <Link href="/studio/events/new" className={buttonClass({ variant: 'primary' })}>
              <Plus className="size-4" /> {t('new')}
            </Link>
          )
        }
      />
      <EventFilters initial={filters} />
      {events.length === 0 ? (
        <div className="card mt-4">
          <EmptyState
            icon={<CalendarDays className="size-5" />}
            title={filtered ? t('noMatchTitle') : filters.archived ? t('noArchivedTitle') : t('emptyTitle')}
            body={filtered ? t('noMatchBody') : filters.archived ? undefined : t('emptyBody')}
          />
        </div>
      ) : (
        <div className="card mt-4 overflow-hidden">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead className="border-b border-line bg-sunken/50 text-left">
              <tr>
                <th scope="col" className="eyebrow px-5 py-2.5 font-semibold sm:px-6">
                  {t('columns.name')}
                </th>
                <th scope="col" className="eyebrow hidden px-3 py-2.5 font-semibold md:table-cell">
                  {t('columns.date')}
                </th>
                <th scope="col" className="eyebrow hidden px-3 py-2.5 text-right font-semibold sm:table-cell">
                  {t('columns.sessions')}
                </th>
                <th scope="col" className="eyebrow hidden px-3 py-2.5 text-right font-semibold sm:table-cell">
                  {t('columns.storage')}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  <span className="sr-only">{t('columns.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.map((e) => (
                <tr key={e.id} className="transition-colors hover:bg-sunken/40">
                  <td className="px-5 py-3.5 sm:px-6">
                    <div className="flex items-center gap-3">
                      {e.mode === 'video360' ? (
                        <RotateCw className="size-4 shrink-0 text-faint" aria-label={t('modes.video360')} />
                      ) : (
                        <Images className="size-4 shrink-0 text-faint" aria-label={t('modes.photo')} />
                      )}
                      <Link href={`/studio/events/${e.id}`} className="min-w-0 truncate font-medium hover:underline">
                        {e.name}
                      </Link>
                      {e.status === 'live' && (
                        <Pill tone="ok" dot>
                          {t('status.live')}
                        </Pill>
                      )}
                    </div>
                    <div className="mt-0.5 pl-7 text-[13px] text-muted md:hidden">
                      {formatEventDate(e.date, locale)}
                    </div>
                  </td>
                  <td className="hidden px-3 py-3.5 whitespace-nowrap text-muted md:table-cell">
                    {formatEventDate(e.date, locale)}
                  </td>
                  <td className="tabular hidden px-3 py-3.5 text-right text-muted sm:table-cell">
                    {e.sessions.toLocaleString(locale)}
                  </td>
                  <td className="tabular hidden px-3 py-3.5 text-right whitespace-nowrap text-muted sm:table-cell">
                    {formatBytes(e.storageBytes, locale)}
                  </td>
                  <td className="px-3 py-3.5 text-right">
                    <EventRowActions id={e.id} name={e.name} archived={e.status === 'archived'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
