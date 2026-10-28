import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Download, Search } from 'lucide-react';
import { LOCALE_NAMES, isLocale } from '@immersia/i18n';
import { formatShortCode, shareSettingsSchema } from '@immersia/shared';
import { Card, EmptyState, Pill, Stat, buttonClass } from '@immersia/ui';
import { roleCan } from '@/lib/permissions';
import { getEvent } from '@/server/events';
import { contactTotals, listContacts } from '@/server/guests';
import { requireOperator } from '@/server/session';
import { DeleteAllContacts, DeleteContact } from './GuestControls';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.guests');
  return { title: t('title') };
}

/**
 * SHR-6, operator side: the people who left their details on this event's guest pages. Personal
 * data, so owners and operators see and export it; viewers see how many there are and nothing else.
 */
export default async function GuestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const op = await requireOperator({ event: ['read'] });
  const event = await getEvent(op.organizationId, id);
  if (!event) notFound();
  const [t, format, totals] = await Promise.all([
    getTranslations('studio.guests'),
    getFormatter(),
    contactTotals(op.organizationId, id),
  ]);
  if (!totals) notFound();

  const canRead = roleCan(op.role, { guest: ['read'] });
  const canExport = roleCan(op.role, { guest: ['export'] });
  const canDelete = roleCan(op.role, { guest: ['delete'] });
  const formOn = shareSettingsSchema.parse(event.shareSettings).guestForm.enabled;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const list = canRead ? await listContacts(op.organizationId, id, { q, page: Number(sp.page) }) : null;
  const base = `/studio/events/${id}/guests`;
  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (page > 1) query.set('page', String(page));
    const s = query.toString();
    return `${base}${s ? `?${s}` : ''}` as `/studio/events/${string}/guests`;
  };

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-[15px] leading-relaxed text-muted">{t('subtitle')}</p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t('stats.contacts')} value={totals.total} />
        <Stat label={t('stats.withName')} value={totals.withName} />
        <Stat
          label={t('stats.form')}
          value={formOn ? t('stats.on') : t('stats.off')}
          tone={formOn ? 'ok' : undefined}
        />
      </div>

      {!formOn && (
        <p className="text-sm text-muted">
          {t('formOff')}{' '}
          <Link
            href={`/studio/events/${id}/setup#sharing`}
            className="focus-ring rounded font-medium text-accent hover:underline"
          >
            {t('formOffLink')}
          </Link>
        </p>
      )}

      {!canRead || !list ? (
        <Pill>{t('viewerNotice')}</Pill>
      ) : (
        <Card pad={false}>
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <form method="get" role="search" className="flex items-end gap-2">
              <label className="block">
                <span className="block text-[13px] font-medium">{t('searchLabel')}</span>
                <span className="mt-1.5 flex h-9 items-center gap-2 rounded-[10px] border border-line-strong bg-elev px-3">
                  <Search className="size-4 text-faint" aria-hidden />
                  <input
                    name="q"
                    defaultValue={q}
                    maxLength={100}
                    placeholder={t('searchPlaceholder')}
                    autoComplete="off"
                    className="w-52 bg-transparent text-sm outline-none placeholder:text-faint"
                  />
                </span>
              </label>
              <button type="submit" className={buttonClass()}>
                {t('search')}
              </button>
              {q && (
                <Link href={base as `/studio/events/${string}/guests`} className={buttonClass({ variant: 'ghost' })}>
                  {t('clear')}
                </Link>
              )}
            </form>
            <div className="flex flex-wrap items-center gap-2">
              {canExport && (
                <a href={`/api/events/${id}/guests`} download className={buttonClass()}>
                  <Download className="size-4" aria-hidden /> {t('export')}
                </a>
              )}
              {canDelete && <DeleteAllContacts eventId={id} count={totals.total} />}
            </div>
          </div>
          {canExport && <p className="px-5 pt-3 text-[13px] text-faint sm:px-6">{t('exportHelp')}</p>}

          {list.matching === 0 ? (
            <EmptyState
              icon={<Search className="size-5" />}
              title={q ? t('noMatch', { q }) : t('empty')}
              body={q ? undefined : t('emptyBody')}
            />
          ) : (
            <div className="overflow-x-auto">
              <p className="px-5 pt-3 pb-2 text-[13px] text-muted sm:px-6">{t('showing', { count: list.matching })}</p>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-y border-line text-[12px] text-faint">
                    <th scope="col" className="px-5 py-2 font-semibold sm:px-6">
                      {t('columns.name')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {t('columns.email')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {t('columns.consent')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {t('columns.where')}
                    </th>
                    {canDelete && (
                      <td className="px-5 py-2 sm:px-6">
                        <span className="sr-only">{t('delete')}</span>
                      </td>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line align-top">
                  {list.rows.map((c) => (
                    <tr key={c.id}>
                      <th scope="row" className="px-5 py-3 font-medium sm:px-6">
                        {c.name ?? <span className="font-normal text-faint">{t('noName')}</span>}
                      </th>
                      <td className="px-3 py-3 break-all">{c.email}</td>
                      <td className="px-3 py-3">
                        <time dateTime={c.consentAt.toISOString()}>
                          {format.dateTime(c.consentAt, { dateStyle: 'medium', timeStyle: 'short' })}
                        </time>
                        <details className="mt-1 text-[13px]">
                          <summary className="focus-ring cursor-pointer rounded text-accent">
                            {t('consentWording')}
                          </summary>
                          <div className="mt-1.5 max-w-xs space-y-1 leading-relaxed text-muted">
                            <p>{c.consentText || '—'}</p>
                            <p>
                              {t('consentLanguage')}:{' '}
                              {isLocale(c.consentLocale) ? LOCALE_NAMES[c.consentLocale] : c.consentLocale}
                            </p>
                            <p className="break-all">
                              {t('consentPolicy')}: {c.policyUrl || t('consentGeneral')}
                            </p>
                          </div>
                        </details>
                      </td>
                      <td className="px-3 py-3">
                        {c.linkId && c.sessionCode ? (
                          <Link
                            href={`/s/${c.linkId}`}
                            aria-label={t('openSession', { code: formatShortCode(c.sessionCode) })}
                            className="focus-ring rounded font-mono font-semibold text-accent hover:underline"
                          >
                            {formatShortCode(c.sessionCode)}
                          </Link>
                        ) : (
                          <span className="text-muted">{t('gallery')}</span>
                        )}
                      </td>
                      {canDelete && (
                        <td className="px-5 py-2 text-right sm:px-6">
                          <DeleteContact eventId={id} contactId={c.id} email={c.email} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {list.pages > 1 && (
            <nav
              aria-label={t('pageOf', { page: list.page, pages: list.pages })}
              className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-6"
            >
              {list.page > 1 ? (
                <Link href={pageHref(list.page - 1)} className={buttonClass({ size: 'sm' })}>
                  {t('previous')}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-[13px] text-muted">{t('pageOf', { page: list.page, pages: list.pages })}</span>
              {list.page < list.pages ? (
                <Link href={pageHref(list.page + 1)} className={buttonClass({ size: 'sm' })}>
                  {t('next')}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </Card>
      )}

      {canDelete && (
        <p className="text-[13px] text-muted">
          {t('requests')}{' '}
          <Link href="/studio/settings#privacy" className="focus-ring rounded font-medium text-accent hover:underline">
            {t('requestsLink')}
          </Link>
        </p>
      )}
    </div>
  );
}
