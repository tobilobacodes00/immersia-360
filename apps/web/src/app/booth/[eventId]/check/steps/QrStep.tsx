'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { QrCode } from '@immersia/ui';
import { BoothHelpLink } from '@/components/BoothHelpLink';
import { HELP_ARTICLES } from '@/lib/help-links';
import { gradeQr, isLocalOrigin, worst, type Finding, type QrCode as QrFindingCode } from '@/lib/setup-check/grading';
import { sleep } from '@/lib/setup-check/measure';
import { FindingList, SKIPPED, StepActions, outcomeOf, type StepProps } from '../check-ui';

const POLL_MS = 2000;

type State =
  { kind: 'creating' } | { kind: 'waiting'; url: string } | { kind: 'done'; findings: Finding<QrFindingCode>[] };

/**
 * Step 5: the guest's side of sharing. The booth shows a QR to a short-lived page on this server;
 * when a phone opens it, the page records the scan and the booth, polling, sees "Scanned".
 */
export function QrStep({ session, onDone }: StepProps) {
  const t = useTranslations('check.qr');
  const [state, setState] = useState<State>({ kind: 'creating' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let off = false;
    const finish = (findings: Finding<QrFindingCode>[]) => {
      if (!off) setState({ kind: 'done', findings });
    };
    void (async () => {
      const started = await session.api.startQr();
      if (off) return;
      if (!started.ok) return finish(gradeQr({ kind: started.status === 0 ? 'offline' : 'failed' }));
      const { token, nonce, expiresAt } = started.data;
      setState({ kind: 'waiting', url: `${window.location.origin}/check/${token}` });
      while (!off && Date.now() < expiresAt) {
        await sleep(POLL_MS);
        if (off) return;
        const polled = await session.api.pollQr(nonce);
        if (polled.ok && polled.data.scanned)
          return finish(gradeQr({ kind: 'scanned', localhost: isLocalOrigin(window.location.hostname) }));
        if (!polled.ok && polled.status !== 0) return finish(gradeQr({ kind: 'failed' }));
      }
      finish(gradeQr({ kind: 'expired' }));
    })();
    return () => {
      off = true;
    };
  }, [session, attempt]);

  const done = state.kind === 'done' ? state : null;
  const text = (f: Finding<QrFindingCode>) => t(`findings.${f.code}`, { host: window.location.host });
  const scanned = done?.findings.some((f) => f.code === 'ok' || f.code === 'okLocalhost') ?? false;
  const retry = () => {
    setState({ kind: 'creating' });
    setAttempt((n) => n + 1);
  };
  return (
    <div>
      <p className="text-sm leading-relaxed text-muted">{t('intro')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-6">
        <div className="w-44 shrink-0 rounded-xl border border-line bg-white p-2">
          {state.kind === 'waiting' ? (
            <QrCode value={state.url} label={t('qrLabel')} />
          ) : (
            <div className="grid aspect-square place-items-center text-center text-[13px] text-faint">
              {scanned ? <CheckCircle2 className="size-12 text-ok" aria-hidden /> : t('creating')}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          {state.kind === 'waiting' && (
            <>
              <p role="status" className="text-sm font-medium">
                {t('waiting')}
              </p>
              <p className="text-[13px] leading-relaxed text-faint">
                {t('manual')}{' '}
                <a
                  href={state.url}
                  className="focus-ring break-all rounded text-accent underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {state.url}
                </a>
              </p>
            </>
          )}
          {scanned && (
            <p role="status" className="flex items-center gap-2 text-base font-semibold text-ok">
              <CheckCircle2 className="size-5" aria-hidden /> {t('scanned')}
            </p>
          )}
        </div>
      </div>
      {done && (
        <div className="mt-4">
          <FindingList
            findings={done.findings}
            text={text}
            help={(f) =>
              f.status !== 'pass' ? <BoothHelpLink slug={HELP_ARTICLES.sharing} label={t('help')} /> : null
            }
          />
        </div>
      )}
      <StepActions
        busy={state.kind === 'creating'}
        status={done ? worst(done.findings) : null}
        retryLabel={t('newCode')}
        onRetry={retry}
        onContinue={() => done && onDone(outcomeOf(done.findings, text))}
        onSkip={() => onDone(SKIPPED)}
      />
    </div>
  );
}
