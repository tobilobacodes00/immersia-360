'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@immersia/ui';
import { extendGuestFilesAction } from '../../actions';
import { useCan } from '../../operator-context';

/** DL-12: give every live guest link of the event more time. */
export function ExtendGuestFiles({ eventId, live }: { eventId: string; live: number }) {
  const t = useTranslations('studio.dashboard');
  const canUpdate = useCan({ event: ['update'] });
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (!canUpdate || live === 0) return null;

  const extend = (days: 7 | 30) =>
    start(async () => {
      const res = await extendGuestFilesAction(eventId, days);
      setMessage(res.ok ? t('extended', { count: res.data.extended, days }) : t('extendFailed'));
    });

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={() => extend(7)} disabled={pending}>
        {t('extend', { days: 7 })}
      </Button>
      <Button size="sm" onClick={() => extend(30)} disabled={pending}>
        {t('extend', { days: 30 })}
      </Button>
      <p className="w-full text-[13px] text-muted" aria-live="polite">
        {message ?? t('extendHelp')}
      </p>
    </div>
  );
}
