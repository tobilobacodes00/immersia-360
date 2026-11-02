'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations, type Messages } from 'next-intl';
import { RotateCcw } from 'lucide-react';
import { Button, Pill, type PillTone } from '@immersia/ui';
import { formatClock, formatRelative } from '@/lib/format';
import { retryServerRenderAction } from '../../render-actions';
import { useCan } from '../../operator-context';

export interface ServerRenderView {
  id: string;
  stage: 'queued' | 'rendering' | 'done' | 'failed';
  attempts: number;
  error: string | null;
  shortCode: string;
  createdAt: string;
  renderMs: number | null;
  canRetry: boolean;
}

type ErrorKey = keyof Messages['studio']['dashboard']['serverRenders']['errors'];

const TONE: Record<ServerRenderView['stage'], PillTone> = {
  queued: 'neutral',
  rendering: 'info',
  done: 'ok',
  failed: 'bad',
};

/**
 * EVT-3: the event's server renders (the last rung of the render ladder): what is waiting, rendering,
 * done or failed, and a way to start a failed one again. Jobs retry by themselves with a delay; this
 * is for the ones that gave up.
 */
export function ServerRenders({
  eventId,
  rows,
  counts,
}: {
  eventId: string;
  rows: ServerRenderView[];
  counts: Record<ServerRenderView['stage'], number>;
}) {
  const t = useTranslations('studio.dashboard.serverRenders');
  const te = useTranslations('studio.dashboard.serverRenders.errors');
  const locale = useLocale();
  const canUpdate = useCan({ event: ['update'] });
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null);

  const retry = (row: ServerRenderView) =>
    start(async () => {
      const res = await retryServerRenderAction(eventId, row.id);
      if (res.ok) return setMessage({ id: row.id, text: t('retried') });
      const reason = res.issues?.[0];
      setMessage({
        id: row.id,
        text:
          reason === 'files_gone' ? t('retryFilesGone') : reason === 'conflict' ? t('retryConflict') : t('retryFailed'),
      });
    });

  const error = (code: string | null) => {
    if (!code) return null;
    return te.has(code as ErrorKey) ? te(code as ErrorKey) : te('failed');
  };

  return (
    <section aria-labelledby="server-renders-heading">
      <h2 id="server-renders-heading" className="eyebrow mb-3">
        {t('title')}
      </h2>
      <div className="card divide-y divide-line">
        <div className="space-y-2 px-5 py-4">
          <p className="max-w-2xl text-[13px] leading-relaxed text-muted">{t('intro')}</p>
          <div className="flex flex-wrap gap-2">
            {(['queued', 'rendering', 'done', 'failed'] as const).map((stage) => (
              <Pill key={stage} tone={TONE[stage]}>
                {t(`stage.${stage}`)} · {counts[stage].toLocaleString(locale)}
              </Pill>
            ))}
          </div>
        </div>
        <ul>
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t('code', { code: row.shortCode })}</div>
                <div className="tabular text-[12px] text-faint">
                  {formatRelative(new Date(row.createdAt), locale)}
                  {row.stage === 'done' && row.renderMs !== null && (
                    <> · {t('took', { time: formatClock(row.renderMs) })}</>
                  )}
                  {row.attempts > 1 && <> · {t('attempts', { count: row.attempts })}</>}
                  {row.error && (
                    <>
                      {' · '}
                      {error(row.error)}
                    </>
                  )}
                </div>
                {message?.id === row.id && (
                  <p role="status" className="mt-1 text-[12px] text-muted">
                    {message.text}
                  </p>
                )}
              </div>
              <Pill tone={TONE[row.stage]}>{t(`stage.${row.stage}`)}</Pill>
              {row.stage === 'failed' && canUpdate && row.canRetry && (
                <Button size="sm" onClick={() => retry(row)} disabled={pending}>
                  <RotateCcw className="size-3.5" aria-hidden /> {t('retry')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
