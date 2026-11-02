'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { CheckCircle2, CircleX, TriangleAlert } from 'lucide-react';
import { describeUserAgent, type SetupCheckStep } from '@immersia/shared';
import { Button, Pill, buttonClass } from '@immersia/ui';
import { BoothHelpLink } from '@/components/BoothHelpLink';
import { emitDeviceEvent } from '@/lib/analytics-client';
import { HELP_ARTICLES } from '@/lib/help-links';
import { overall } from '@/lib/setup-check/grading';
import { formatSeconds } from '@/lib/setup-check/render-estimate';
import { markCheckDone, SETUP_CHECK_EVENT } from '@/lib/setup-check/state';
import { LineList, StatusPill, type Facts, type Outcome } from './check-ui';
import type { CheckSession } from './check-session';

type Sent = 'sending' | 'sent' | 'failed';

const VERDICT = {
  pass: { Icon: CheckCircle2, className: 'text-ok' },
  warn: { Icon: TriangleAlert, className: 'text-warn' },
  fail: { Icon: CircleX, className: 'text-bad' },
} as const;

/** The end of the check: every step at a glance, the overall verdict, and the result sent to the account. */
export function Summary({
  session,
  eventId,
  steps,
  outcomes,
  facts,
  backHref,
  onRestart,
}: {
  session: CheckSession;
  eventId: string;
  steps: readonly SetupCheckStep[];
  outcomes: Partial<Record<SetupCheckStep, Outcome>>;
  facts: Facts;
  backHref: Route;
  onRestart: () => void;
}) {
  const t = useTranslations('check');
  const [sent, setSent] = useState<Sent>('sending');
  const verdict = overall(steps.map((s) => outcomes[s]?.status ?? 'skipped'));
  const { Icon, className } = VERDICT[verdict];

  const send = useCallback(async (): Promise<Sent> => {
    const res = await session.api.report({
      eventId,
      renderSpeedMs: facts.referenceMs === null ? null : Math.round(facts.referenceMs),
      cameraFps: facts.cameraFps,
      cameraResolution: facts.cameraResolution,
      renderPath: facts.renderPath,
      browser: describeUserAgent(navigator.userAgent).browser,
      results: steps.map((step) => ({ step, status: outcomes[step]?.status ?? 'skipped' })),
    });
    return res.ok ? 'sent' : 'failed';
  }, [session, eventId, facts, steps, outcomes]);

  // The check is over: let go of the camera, the render worker and the test take.
  useEffect(() => {
    void session.dispose();
  }, [session]);

  useEffect(() => {
    let off = false;
    void send().then((result) => {
      if (off) return;
      setSent(result);
      // The PRD's `setup_check_completed`, from the booth like its other events: kept on the device and
      // sent when the network allows, so it is counted whether or not the report above got through.
      emitDeviceEvent(
        {
          name: 'setup_check_completed',
          render_speed_ms: Math.min(3_600_000, Math.max(0, Math.round(facts.referenceMs ?? 0))),
          camera_fps: Math.min(960, Math.max(0, Math.round(facts.cameraFps))),
          browser: describeUserAgent(navigator.userAgent).browser,
        },
        eventId,
      );
      // The check was run: the first-run offer is made once per device, whether or not the report got through.
      try {
        markCheckDone(localStorage, session.deviceId, Date.now());
        window.dispatchEvent(new Event(SETUP_CHECK_EVENT));
      } catch {
        // Storage unavailable: the offer may appear again, which is harmless.
      }
    });
    return () => {
      off = true;
    };
  }, [send, session, facts, eventId]);

  return (
    <section aria-labelledby="check-summary" className="card">
      <header className="flex flex-wrap items-start gap-4 border-b border-line px-5 py-5 sm:px-6">
        <Icon className={`mt-1 size-6 shrink-0 ${className}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="check-summary" className="text-lg font-semibold tracking-[-0.01em]">
            {t('summary.title')}
          </h2>
          <p role="status" className="mt-1 text-sm leading-relaxed text-muted">
            {t(`summary.verdict.${verdict}`)}
          </p>
        </div>
      </header>
      <ul className="divide-y divide-line">
        {steps.map((step) => {
          const outcome = outcomes[step];
          const attention = outcome?.lines.filter((l) => l.status !== 'pass') ?? [];
          return (
            <li key={step} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 sm:px-6">
              <span className="min-w-0 flex-1 text-sm font-medium">{t(`steps.${step}`)}</span>
              <StatusPill status={outcome?.status ?? 'skipped'} />
              {attention.length > 0 && (
                <div className="basis-full pt-1.5">
                  <LineList lines={attention} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="space-y-2 border-t border-line px-5 py-4 text-[13px] leading-relaxed text-muted sm:px-6">
        {facts.referenceMs !== null && (
          <p>
            {t('summary.render', {
              seconds: formatSeconds(facts.referenceMs),
              path: t(`summary.paths.${facts.renderPath}`),
            })}
          </p>
        )}
        <p role="status">
          {sent === 'sending' && t('summary.sending')}
          {sent === 'sent' && t('summary.sent')}
          {sent === 'failed' && (
            <>
              {t('summary.failed')}{' '}
              <Button
                size="sm"
                onClick={() => {
                  setSent('sending');
                  void send().then(setSent);
                }}
              >
                {t('summary.retrySend')}
              </Button>
            </>
          )}
        </p>
        <Pill tone="neutral">{t('summary.nothingKept')}</Pill>
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4 sm:px-6">
        <Link href={backHref} className={buttonClass({ variant: 'primary' })}>
          {t('actions.finish')}
        </Link>
        <Button onClick={onRestart}>{t('actions.runAgain')}</Button>
        <BoothHelpLink slug={HELP_ARTICLES.setupCheck} label={t('summary.help')} className="ml-auto" />
      </footer>
    </section>
  );
}
