'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BoothHelpLink } from '@/components/BoothHelpLink';
import { HELP_ARTICLES } from '@/lib/help-links';
import {
  RENDER_TARGET_LAPTOP_MS,
  RENDER_TARGET_TABLET_MS,
  chooseRenderPath,
  gradeRender,
  worst,
  type Finding,
  type RenderCode,
} from '@/lib/setup-check/grading';
import { formatSeconds } from '@/lib/setup-check/render-estimate';
import type { RenderOutcome } from '../check-session';
import { FindingList, Measurements, Progress, StepActions, outcomeOf, type StepProps } from '../check-ui';

type State =
  { kind: 'rendering'; share: number } | { kind: 'done'; outcome: RenderOutcome; findings: Finding<RenderCode>[] };

/**
 * Step 4: render the test take for real, in the render worker, with the event's output preset, then
 * scale the measured speed to the PRD's yardstick (a 15 s 1080p clip: 45 s on a laptop, 90 s on a
 * 2021 iPad) and record the verdict as the device's render path.
 */
export function RenderStep({ session, plan, onDone }: StepProps) {
  const t = useTranslations('check.render');
  const [state, setState] = useState<State>({ kind: 'rendering', share: 0 });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let off = false;
    void session
      .renderTestTake((share) => {
        if (!off) setState({ kind: 'rendering', share });
      })
      .then((outcome) => {
        if (off) return;
        const noTake = session.take === null;
        setState({
          kind: 'done',
          outcome,
          findings: gradeRender(
            outcome.kind === 'done'
              ? {
                  kind: 'estimate',
                  referenceMs: outcome.referenceMs,
                  backgroundUnavailable: outcome.background === 'unavailable',
                }
              : { kind: 'error', code: noTake ? 'noTake' : outcome.code },
          ),
        });
      });
    return () => {
      off = true;
    };
  }, [session, attempt]);

  const done = state.kind === 'done' ? state : null;
  const text = (f: Finding<RenderCode>) => t(`findings.${f.code}`, f.params ?? {});
  const result = done?.outcome.kind === 'done' ? done.outcome : null;
  const preset = plan.render;
  return (
    <div>
      <p className="text-sm leading-relaxed text-muted">
        {t('intro', {
          resolution: preset.resolution === '2160p' ? '4K' : preset.resolution,
          fps: preset.fps,
          laptop: Math.round(RENDER_TARGET_LAPTOP_MS / 1000),
          tablet: Math.round(RENDER_TARGET_TABLET_MS / 1000),
        })}
      </p>
      {state.kind === 'rendering' && (
        <div role="status" className="mt-4 space-y-2">
          <p className="text-sm font-medium">{t('rendering')}</p>
          <Progress share={state.share} label={t('progress')} />
        </div>
      )}
      {result && (
        <Measurements
          rows={[
            {
              label: t('stats.rendered'),
              value: t('stats.renderedValue', {
                frames: result.measurement.frames,
                size: `${result.measurement.width}×${result.measurement.height}`,
                seconds: formatSeconds(result.measurement.renderMs),
              }),
            },
            { label: t('stats.reference'), value: t('stats.seconds', { seconds: formatSeconds(result.referenceMs) }) },
            { label: t('stats.event'), value: t('stats.seconds', { seconds: formatSeconds(result.eventMs) }) },
            {
              label: t('stats.path'),
              value: t(`paths.${chooseRenderPath({ kind: 'estimate', referenceMs: result.referenceMs })}`),
            },
          ]}
        />
      )}
      {done && (
        <div className="mt-4 space-y-2">
          <FindingList
            findings={done.findings}
            text={text}
            help={(f) =>
              f.status !== 'pass' ? <BoothHelpLink slug={HELP_ARTICLES.renderSpeed} label={t('help')} /> : null
            }
          />
          {result && <p className="pl-7 text-[13px] leading-relaxed text-faint">{t('estimateNote')}</p>}
        </div>
      )}
      <StepActions
        busy={!done}
        status={done ? worst(done.findings) : null}
        onRetry={() => {
          setState({ kind: 'rendering', share: 0 });
          setAttempt((n) => n + 1);
        }}
        onContinue={() => {
          if (!done) return;
          onDone(outcomeOf(done.findings, text), {
            referenceMs: result ? result.referenceMs : null,
            eventMs: result ? result.eventMs : null,
            renderPath: chooseRenderPath(
              result ? { kind: 'estimate', referenceMs: result.referenceMs } : { kind: 'error' },
            ),
          });
        }}
      />
    </div>
  );
}
