'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { EyeOff, Eye } from 'lucide-react';
import { formatShortCode, type RemovalBasis, type ReportReason, type ReportStatus } from '@immersia/shared';
import { Button, Pill, type PillTone } from '@immersia/ui';
import { hideSessionAction, restoreSessionAction } from '../report-actions';
import { useCan } from '../operator-context';

/** A report as the operator sees it: what, why and how it stands. */
export interface ReportView {
  id: string;
  sessionId: string;
  eventId: string;
  eventName: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  /** When it was filed, already in words ("3 hours ago"): formatted on the server so the page hydrates cleanly. */
  when: string;
  shortCode: string;
  linkId: string;
  removal: RemovalBasis | null;
}

const STATUS_TONE: Record<ReportStatus, PillTone> = {
  open: 'warn',
  escalated: 'warn',
  actioned: 'ok',
  dismissed: 'neutral',
};

/**
 * The reports against an event's (or the whole studio's) guest items. The operator can hide an item
 * the moment they see the report; the platform decides the report itself (take down, dismiss,
 * escalate) within 24 hours. A hidden item is gone from the share page, gallery, Live Display and
 * Sharing Station together, and comes back with Restore, unless the platform removed it.
 */
export function ReportList({ items, showEvent }: { items: ReportView[]; showEvent?: boolean }) {
  const t = useTranslations('studio.reports');
  const canHide = useCan({ report: ['hide'] });
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  // What the page said when it was rendered; a hide or restore is reflected at once, then confirmed.
  const [overrides, setOverrides] = useState<Record<string, 'hidden' | 'visible'>>({});

  const run = (sessionId: string, to: 'hidden' | 'visible') =>
    start(async () => {
      setMessage(null);
      const res = await (to === 'hidden' ? hideSessionAction(sessionId) : restoreSessionAction(sessionId));
      if (res.ok) {
        setOverrides((o) => ({ ...o, [sessionId]: to }));
        setMessage(to === 'hidden' ? t('hiddenDone') : t('restoredDone'));
      } else setMessage(res.error === 'conflict' ? t('takenDown') : t('failed'));
    });

  return (
    <div>
      <ul className="divide-y divide-line">
        {items.map((item) => {
          const state =
            item.removal === 'policy' || item.removal === 'legal'
              ? 'removed'
              : (overrides[item.sessionId] ?? (item.removal === 'operator' ? 'hidden' : 'visible'));
          return (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 py-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{t(`reasons.${item.reason}`)}</span>
                  <Pill tone={STATUS_TONE[item.status]}>{t(`status.${item.status}`)}</Pill>
                  {state === 'hidden' && (
                    <Pill tone="info">
                      <EyeOff className="size-3" aria-hidden /> {t('stateHidden')}
                    </Pill>
                  )}
                  {state === 'removed' && <Pill tone="bad">{t('stateRemoved')}</Pill>}
                </div>
                {item.details && <p className="max-w-prose text-[13px] leading-relaxed text-muted">“{item.details}”</p>}
                <p className="text-[13px] text-muted">
                  {showEvent && (
                    <>
                      <Link href={`/studio/events/${item.eventId}`} className="font-medium text-fg hover:underline">
                        {item.eventName}
                      </Link>
                      {' · '}
                    </>
                  )}
                  {t('capture')} <span className="font-mono">{formatShortCode(item.shortCode)}</span>
                  {' · '}
                  {item.when}
                  {state !== 'removed' && (
                    <>
                      {' · '}
                      <a
                        href={`/s/${item.linkId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-accent"
                      >
                        {t('open')}
                      </a>
                    </>
                  )}
                </p>
              </div>
              {canHide && state === 'visible' && (
                <Button
                  size="sm"
                  disabled={pending}
                  icon={<EyeOff className="size-3.5" aria-hidden />}
                  onClick={() => run(item.sessionId, 'hidden')}
                >
                  {t('hide')}
                </Button>
              )}
              {canHide && state === 'hidden' && (
                <Button
                  size="sm"
                  disabled={pending}
                  icon={<Eye className="size-3.5" aria-hidden />}
                  onClick={() => run(item.sessionId, 'visible')}
                >
                  {t('restore')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <p role="status" className="min-h-5 pb-3 text-[13px] text-muted">
        {message}
      </p>
    </div>
  );
}
