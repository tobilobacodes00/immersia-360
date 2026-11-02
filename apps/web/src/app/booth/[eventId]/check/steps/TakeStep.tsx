'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CircleDot } from 'lucide-react';
import { Button } from '@immersia/ui';
import { formatBytes } from '@/lib/format';
import { gradeTake, worst, type Finding, type TakeCode } from '@/lib/setup-check/grading';
import { TEST_TAKE_SECONDS } from '@/lib/setup-check/render-estimate';
import type { TestTake } from '../check-session';
import { FindingList, Measurements, Progress, StepActions, outcomeOf, type StepProps } from '../check-ui';

type State =
  | { kind: 'idle' }
  | { kind: 'recording'; share: number }
  | { kind: 'done'; findings: Finding<TakeCode>[]; take: TestTake | null };

/**
 * Step 3: a few seconds through the booth's own capture path: camera, recorder, on-device storage,
 * and the file read back. The render step then works on this take.
 */
export function TakeStep({ session, onDone }: StepProps) {
  const t = useTranslations('check.take');
  const te = useTranslations('booth.errors');
  const locale = useLocale();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const video = useRef<HTMLVideoElement>(null);
  const noCamera = session.camera === null;

  useEffect(() => {
    const el = video.current;
    const camera = session.camera;
    if (el && camera) {
      el.srcObject = camera.stream;
      void el.play().catch(() => undefined);
    }
    return () => {
      if (el) el.srcObject = null;
    };
  }, [session]);

  const record = async () => {
    setState({ kind: 'recording', share: 0 });
    const outcome = await session.recordTestTake((share) => setState({ kind: 'recording', share }));
    setState({
      kind: 'done',
      findings: gradeTake(
        outcome.kind === 'recorded'
          ? {
              kind: 'recorded',
              requestedMs: TEST_TAKE_SECONDS * 1000,
              recordedMs: outcome.take.durationMs,
              bytes: outcome.take.bytes,
              chunks: outcome.take.chunks,
            }
          : outcome,
      ),
      take: outcome.kind === 'recorded' ? outcome.take : null,
    });
  };

  const done = state.kind === 'done' ? state : null;
  const recording = state.kind === 'recording';
  const text = (f: Finding<TakeCode>) =>
    f.code === 'unsupported' ? te('recording_unsupported') : t(`findings.${f.code}`, f.params ?? {});
  const findings = noCamera ? gradeTake({ kind: 'noCamera' }) : (done?.findings ?? null);
  return (
    <div>
      <p className="text-sm leading-relaxed text-muted">{t('intro', { seconds: TEST_TAKE_SECONDS })}</p>
      <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="aspect-video overflow-hidden rounded-xl bg-ink">
          <video ref={video} muted playsInline autoPlay aria-hidden className="size-full object-cover" />
        </div>
        <div className="flex flex-col justify-center gap-4">
          <Button variant="primary" size="lg" disabled={recording || noCamera} onClick={() => void record()}>
            <CircleDot className="size-4" aria-hidden /> {done ? t('again') : t('record')}
          </Button>
          {state.kind === 'recording' && (
            <div role="status" className="space-y-2">
              <p className="text-sm font-medium">{t('recording')}</p>
              <Progress share={state.share} label={t('progress')} />
            </div>
          )}
        </div>
      </div>

      {done?.take && (
        <Measurements
          rows={[
            {
              label: t('stats.length'),
              value: t('stats.seconds', { seconds: Math.round(done.take.durationMs / 100) / 10 }),
            },
            { label: t('stats.size'), value: formatBytes(done.take.bytes, locale) },
            { label: t('stats.format'), value: done.take.mimeType },
            { label: t('stats.chunks'), value: done.take.chunks },
          ]}
        />
      )}

      {findings && (
        <div className="mt-4">
          <FindingList findings={findings} text={text} />
        </div>
      )}

      <StepActions
        busy={recording}
        status={findings ? worst(findings) : null}
        onContinue={() => findings && onDone(outcomeOf(findings, text))}
      />
    </div>
  );
}
