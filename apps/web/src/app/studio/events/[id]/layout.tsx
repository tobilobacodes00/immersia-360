import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Images, Play, RotateCw } from 'lucide-react';
import { eventBooths, outputSettingsSchema } from '@immersia/shared';
import { Pill, buttonClass } from '@immersia/ui';
import { formatEventDate } from '@/lib/format';
import { roleCan } from '@/lib/permissions';
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
  const [t, tb, locale] = await Promise.all([getTranslations('studio.events'), getTranslations('booth'), getLocale()]);
  const booths = eventBooths(event.mode, outputSettingsSchema.parse(event.outputSettings));
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
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-[30px] leading-[1.05] font-bold tracking-[-0.03em] sm:text-[36px]">{event.name}</h1>
          {event.status !== 'archived' && roleCan(op.role, { event: ['run'] }) && (
            <div className="flex flex-wrap gap-2">
              {booths.length > 1 && (
                <Link href={`/booth/${event.id}?booth=${booths[1]}`} className={buttonClass({ size: 'lg' })}>
                  <Play className="size-4 fill-current" aria-hidden />{' '}
                  {tb('startOther', { booth: t(`modes.${booths[1]!}`) })}
                </Link>
              )}
              <Link href={`/booth/${event.id}`} className={buttonClass({ variant: 'primary', size: 'lg' })}>
                <Play className="size-4 fill-current" aria-hidden /> {tb('startBooth')}
              </Link>
            </div>
          )}
        </div>
        <EventTabs id={event.id} />
      </div>
      {children}
    </>
  );
}
