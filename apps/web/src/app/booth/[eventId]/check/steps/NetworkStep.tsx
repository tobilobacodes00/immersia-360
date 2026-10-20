'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { HelpLink } from '@/components/HelpLink';
import { HELP_ARTICLES } from '@/lib/help-links';
import { gradeNetwork, worst, type Finding, type NetworkCode } from '@/lib/setup-check/grading';
import type { NetworkOutcome } from '../check-session';
import { FindingList, Measurements, SKIPPED, StepActions, outcomeOf, type StepProps } from '../check-ui';

type State = { kind: 'running' } | { kind: 'done'; outcome: NetworkOutcome; findings: Finding<NetworkCode>[] };

/**
 * Step 7: the path a guest's file takes. A signed upload of one megabyte straight to storage, then
 * the server confirms it arrived whole and deletes it: it proves the device can reach the server,
 * is still registered, and that storage accepts its uploads.
 */
export function NetworkStep({ session, onDone }: StepProps) {
  const t = useTranslations('check.network');
  const [state, setState] = useState<State>({ kind: 'running' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let off = false;
    void session.uploadProbe().then((outcome) => {
      if (!off)
        setState({
          kind: 'done',
          outcome,
          findings: gradeNetwork(outcome.kind === 'ok' ? { kind: 'ok', mbps: outcome.mbps } : outcome),
        });
    });
    return () => {
      off = true;
    };
  }, [session, attempt]);

  const done = state.kind === 'done' ? state : null;
  const text = (f: Finding<NetworkCode>) => t(`findings.${f.code}`, f.params ?? {});
  const mbps = done?.outcome.kind === 'ok' ? done.outcome.mbps : null;
  return (
    <div>
      <p className="text-sm leading-relaxed text-muted">{t('intro')}</p>
      {!done && (
        <p role="status" className="mt-4 text-sm font-medium">
          {t('running')}
        </p>
      )}
      {mbps !== null && (
        <Measurements
          rows={[{ label: t('stats.speed'), value: t('stats.mbps', { mbps: Math.round(mbps * 10) / 10 }) }]}
        />
      )}
      {done && (
        <div className="mt-4">
          <FindingList
            findings={done.findings}
            text={text}
            help={(f) => (f.status !== 'pass' ? <HelpLink slug={HELP_ARTICLES.offline} label={t('help')} /> : null)}
          />
        </div>
      )}
      <StepActions
        busy={!done}
        status={done ? worst(done.findings) : null}
        onRetry={() => {
          setState({ kind: 'running' });
          setAttempt((n) => n + 1);
        }}
        onContinue={() => {
          if (done) onDone(outcomeOf(done.findings, text), { mbps });
        }}
        onSkip={() => onDone(SKIPPED)}
      />
    </div>
  );
}
