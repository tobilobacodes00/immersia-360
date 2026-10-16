import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Images, RotateCw } from 'lucide-react';
import { Pill } from '@immersia/ui';
import { formatEventDate } from '@/lib/format';
import { getEvent } from '@/server/events';
import { requireOperator } from '@/server/session';
import { EventTabs } from './EventTabs';

export default async function EventLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const op = await requireOperator({ event: ['read'] });
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await getEvent(op.organizationId, id);
  if (!event) notFound();
  const [t, locale] = await Promise.all([getTranslations('studio.events'), getLocale()]);
  return (
    <>
      <div className="mb-6 border-b border-line pb-0">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          {event.mode === 'video360' ? (
            <RotateCw className="size-3.5" aria-hidden />
          ) : (
            <Images className="size-3.5" aria-hidden />
          )}
          <span>{t(`modes.${event.mode}`)}</span>
          <span aria-hidden>·</span>
          <span>{formatEventDate(event.date, locale, 'long')}</span>
          {event.status === 'live' && (
            <Pill tone="ok" dot>
              {t('status.live')}
            </Pill>
          )}
          {event.status === 'archived' && <Pill>{t('status.archived')}</Pill>}
        </div>
        <h1 className="mt-2 text-[30px] leading-[1.05] font-bold tracking-[-0.03em] sm:text-[36px]">{event.name}</h1>
        <EventTabs id={event.id} />
      </div>
      {children}
    </>
  );
}
