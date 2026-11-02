'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { listLenses, type Lens } from '@immersia/capture';
import { Toggle, cx } from '@immersia/ui';
import { BoothHelpLink } from '@/components/BoothHelpLink';
import { HELP_ARTICLES } from '@/lib/help-links';
import { cameraOpenFailed, gradeCamera, worst, type CameraStepCode, type Finding } from '@/lib/setup-check/grading';
import { measureFps } from '@/lib/setup-check/measure';
import {
  applyChoice,
  needsReopen,
  readCameraChoice,
  saveCameraChoice,
  switchCamera,
  usableChoice,
  type CameraChoice,
} from '../../camera-choice';
import { DEFAULT_CAMERA, LensPicker, SIMULATOR } from '../../LensPicker';
import { FindingList, Measurements, StepActions, outcomeOf, type StepProps } from '../check-ui';

const MEASURE_MS = 2500;

interface Stats {
  label: string;
  deviceId: string | null;
  simulator: boolean;
  width: number;
  height: number;
  reported: number;
  measured: number | null;
}

type Phase =
  | { kind: 'opening' }
  | { kind: 'measuring' }
  | { kind: 'done'; findings: Finding<CameraStepCode>[]; stats: Stats | null };

/**
 * Step 1: choose the camera and lens (the same picker as the booth's settings), see the picture and
 * count the frames the camera really delivers.
 */
export function CameraStep({ session, plan, onDone }: StepProps) {
  const t = useTranslations('check.camera');
  const ts = useTranslations('booth.settings');
  const te = useTranslations('booth.errors');
  // The booth may have saved the companion's native high-speed camera: the check tests the browser's camera, so a
  // native lens id reads as the default camera (nothing is saved until the operator changes something).
  const [choice, setChoice] = useState<CameraChoice>(() => usableChoice(readCameraChoice(), false));
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'opening' });
  const video = useRef<HTMLVideoElement>(null);
  const latest = useRef(0);
  const initial = useRef(choice);

  /**
   * Open the camera, show it, count its frames. Progress goes out through `report` and `found`, so
   * nothing here sets state on its own; a newer run makes an older one fall silent.
   */
  const run = useCallback(
    async (c: CameraChoice, report: (p: Phase) => void, found: (list: Lens[]) => void) => {
      const id = ++latest.current;
      const stale = () => id !== latest.current;
      const opened = await session.openCamera(c);
      if (stale()) return;
      if (!opened.ok) return report({ kind: 'done', findings: cameraOpenFailed(opened.code), stats: null });
      const { camera } = opened;
      const el = video.current;
      if (el) {
        el.srcObject = camera.stream;
        await el.play().catch(() => undefined);
      }
      // Names and ids arrive once the camera has been allowed, so the lenses are listed now.
      void listLenses({ deviceId: camera.settings.deviceId, facingMode: camera.settings.facingMode }).then((list) => {
        if (!stale()) found(list);
      });
      report({ kind: 'measuring' });
      const measured = el ? await measureFps(el, MEASURE_MS) : null;
      if (stale()) return;
      const { width, height, frameRate, deviceId } = camera.settings;
      report({
        kind: 'done',
        findings: gradeCamera({
          simulator: camera.kind === 'simulator',
          targetFps: plan.camera.frameRate,
          measuredFps: measured,
          targetResolution: plan.camera.resolution,
          width,
          height,
        }),
        stats: {
          label: camera.label,
          deviceId,
          simulator: camera.kind === 'simulator',
          width,
          height,
          reported: frameRate,
          measured,
        },
      });
    },
    [session, plan],
  );
  const apply = useCallback((p: Phase) => setPhase(p), []);

  useEffect(() => {
    void run(initial.current, apply, setLenses);
    return () => {
      // Leaving the step (or the page) makes any run in flight fall silent.
      latest.current++;
    };
  }, [run, apply]);

  const change = (patch: Partial<CameraChoice>) => {
    const next = applyChoice(choice, patch);
    setChoice(next);
    // The picture is mirrored by CSS; only a different camera needs reopening. A change that leaves the camera
    // alone is saved onto what was saved, so the native high-speed choice this step does not use survives it.
    const reopen = needsReopen(choice, next);
    saveCameraChoice(reopen ? next : applyChoice(readCameraChoice(), patch));
    if (reopen) {
      setPhase({ kind: 'opening' });
      void run(next, apply, setLenses);
    }
  };

  const selected = choice.source === 'simulator' ? SIMULATOR : (choice.deviceId ?? DEFAULT_CAMERA);
  const findings = phase.kind === 'done' ? phase.findings : null;
  const stats = phase.kind === 'done' ? phase.stats : null;
  const text = (f: Finding<CameraStepCode>) => {
    switch (f.code) {
      case 'permission':
      case 'not_found':
      case 'in_use':
      case 'overconstrained':
      case 'insecure':
      case 'unknown':
        return te(f.code);
      default:
        return t(`findings.${f.code}`, f.params ?? {});
    }
  };

  return (
    <div>
      <p className="text-sm leading-relaxed text-muted">{t('intro')}</p>
      <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-ink">
          <video
            ref={video}
            muted
            playsInline
            autoPlay
            aria-hidden
            className={cx('size-full object-cover', choice.mirror && '-scale-x-100')}
          />
          {phase.kind !== 'done' && (
            <p role="status" className="absolute inset-0 grid place-items-center text-sm font-medium text-white">
              {phase.kind === 'opening' ? t('opening') : t('measuring')}
            </p>
          )}
        </div>
        <div className="space-y-4">
          <LensPicker
            lenses={lenses}
            selected={selected}
            inUse={stats?.deviceId ?? null}
            simulatorInUse={stats?.simulator ?? false}
            disabled={phase.kind !== 'done'}
            onSelect={(value) =>
              change(
                switchCamera(
                  value === SIMULATOR
                    ? { source: 'simulator', deviceId: null }
                    : { source: 'camera', deviceId: value === DEFAULT_CAMERA ? null : value },
                ),
              )
            }
          />
          <div className="flex items-center justify-between gap-4">
            <span className="text-[13px] font-medium">{ts('mirror')}</span>
            <Toggle checked={choice.mirror} onChange={(mirror) => change({ mirror })} label={ts('mirror')} />
          </div>
          <p className="text-[13px] leading-relaxed text-faint">{t('lensHelp')}</p>
        </div>
      </div>

      {stats && (
        <Measurements
          rows={[
            { label: t('stats.camera'), value: stats.label },
            { label: t('stats.size'), value: `${stats.width}×${stats.height}` },
            { label: t('stats.reported'), value: t('stats.fps', { fps: stats.reported }) },
            {
              label: t('stats.measured'),
              value: stats.measured === null ? '—' : t('stats.fps', { fps: Math.round(stats.measured) }),
            },
            {
              label: t('stats.wanted'),
              value: `${plan.camera.resolution} · ${t('stats.fps', { fps: plan.camera.frameRate })}`,
            },
          ]}
        />
      )}

      {findings && (
        <div className="mt-4">
          <FindingList
            findings={findings}
            text={text}
            help={(f) =>
              f.code === 'permission' || f.code === 'not_found' || f.code === 'in_use' ? (
                <BoothHelpLink slug={HELP_ARTICLES.cameraPermissions} label={t('help')} />
              ) : null
            }
          />
        </div>
      )}

      <StepActions
        busy={phase.kind !== 'done'}
        status={findings ? worst(findings) : null}
        onRetry={() => {
          setPhase({ kind: 'opening' });
          void run(choice, apply, setLenses);
        }}
        onContinue={() => {
          if (!findings) return;
          onDone(outcomeOf(findings, text), {
            cameraFps: stats ? Math.round(stats.measured ?? stats.reported) : 0,
            cameraResolution: stats ? `${stats.width}x${stats.height}` : null,
          });
        }}
      />
    </div>
  );
}
