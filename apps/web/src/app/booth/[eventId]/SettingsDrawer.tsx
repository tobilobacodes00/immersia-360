'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'motion/react';
import { Sun, X } from 'lucide-react';
import { listLenses, type Lens } from '@immersia/capture';
import type { LocalTake } from '@immersia/offline';
import { Field, IconButton, Segmented, Slider, Toggle, cx, softSpring } from '@immersia/ui';
import { formatBytes, formatRelative } from '@/lib/format';
import type { ActiveCamera } from './active-camera';
import { FILL_LEVELS, FILL_TINTS, fillLightOf, switchCamera, type CameraChoice } from './camera-choice';
import { DEFAULT_CAMERA, LensPicker, SIMULATOR } from './LensPicker';
import { TakeBadges } from './TakeBadges';

export function SettingsDrawer({
  open,
  onClose,
  choice,
  onChoice,
  camera,
  cameraBusy,
  capture360,
}: {
  open: boolean;
  onClose: () => void;
  choice: CameraChoice;
  /** Report a change to the saved camera choice; the booth reopens the camera if it needs to. */
  onChoice: (patch: Partial<CameraChoice>) => void;
  /** The open camera, or null while none is (before Start, during startup, after an error). */
  camera: ActiveCamera | null;
  /** A guest is using the booth: the camera is left exactly as it is (no reopen, zoom or torch). */
  cameraBusy: boolean;
  /** The 360 booth's motion trigger, video import and takes; the photo booth has none of these. */
  capture360?: Capture360Props;
}) {
  const t = useTranslations('booth.settings');
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [torchFailure, setTorchFailure] = useState<ActiveCamera | null>(null);

  // The drawer is re-rendered by its parent all the time (the recording clock); the listener must
  // not be re-bound, nor the cameras re-listed, each time.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Names and ids arrive with camera permission, so list again whenever a camera opens; and when a
  // camera is plugged in or removed.
  const hasCamera = camera !== null;
  const cameraId = camera?.deviceId ?? null;
  const cameraFacing = camera?.facingMode ?? null;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = () => listLenses(hasCamera ? { deviceId: cameraId, facingMode: cameraFacing } : undefined);
    void load().then((list) => {
      if (!cancelled) setLenses(list);
    });
    const onDevicesChanged = () =>
      void load().then((list) => {
        if (!cancelled) setLenses(list);
      });
    const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    devices?.addEventListener('devicechange', onDevicesChanged);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      devices?.removeEventListener('devicechange', onDevicesChanged);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, hasCamera, cameraId, cameraFacing]);

  const selected = choice.source === 'simulator' ? SIMULATOR : (choice.deviceId ?? DEFAULT_CAMERA);
  const range = camera?.zoom.range ?? null;
  const zoom = choice.zoom ?? camera?.zoomAtOpen ?? range?.min ?? 1;
  const fill = fillLightOf(choice);
  // The glow is for a screen that faces the guest; a back camera's screen faces the operator.
  const canFill = camera?.lens.facing !== 'back';

  const torchOn = Boolean(camera?.torch.supported && choice.torch);
  const torchNote = !camera
    ? t('torchNeedsCamera')
    : !camera.torch.supported
      ? t('noTorch')
      : torchFailure === camera
        ? t('torchFailed')
        : cameraBusy
          ? t('cameraBusy')
          : null;

  const switchTorch = async (on: boolean) => {
    if (!camera) return;
    const result = await camera.torch.set(on);
    setTorchFailure(result.ok ? null : camera);
    if (result.ok) onChoice({ torch: on });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-[#111110]/30" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={t('title')}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={softSpring}
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-bg text-fg shadow-pop"
            style={{ fontSize: 15 }}
          >
            <header className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="text-base font-semibold">{t('title')}</h2>
              <IconButton label={t('close')} onClick={onClose}>
                <X className="size-4" />
              </IconButton>
            </header>
            <div className="flex-1 divide-y divide-line overflow-y-auto px-6">
              <Field label={t('camera')} stack>
                <div className="space-y-3">
                  <LensPicker
                    lenses={lenses}
                    selected={selected}
                    inUse={camera?.deviceId ?? null}
                    simulatorInUse={camera !== null && choice.source === 'simulator'}
                    disabled={cameraBusy}
                    onSelect={(value) =>
                      onChoice(
                        switchCamera(
                          value === SIMULATOR
                            ? { source: 'simulator', deviceId: null }
                            : { source: 'camera', deviceId: value === DEFAULT_CAMERA ? null : value },
                        ),
                      )
                    }
                  />
                  {camera && (
                    <p className="text-[13px] text-muted">
                      {t('delivering', { width: camera.width, height: camera.height, fps: camera.frameRate })}
                    </p>
                  )}
                  {cameraBusy && (
                    <p role="status" className="text-[13px] text-faint">
                      {t('cameraBusy')}
                    </p>
                  )}
                </div>
              </Field>
              {camera && range && (
                <Field label={t('zoom')} stack>
                  {/* A disabled fieldset disables the slider and its number box together. */}
                  <fieldset disabled={cameraBusy} className={cx('min-w-0', cameraBusy && 'opacity-50')}>
                    <Slider
                      label={t('zoom')}
                      value={zoom}
                      min={range.min}
                      max={range.max}
                      step={range.step}
                      unit="×"
                      onChange={(z) => {
                        // The camera takes the newest of a drag's many values; the choice is saved as it goes.
                        void camera.zoom.set(z);
                        onChoice({ zoom: z });
                      }}
                    />
                  </fieldset>
                </Field>
              )}
              <Field label={t('torch')} help={torchNote && <span aria-live="polite">{torchNote}</span>}>
                <Toggle
                  checked={torchOn}
                  label={t('torch')}
                  disabled={!camera?.torch.supported || cameraBusy}
                  onChange={(on) => void switchTorch(on)}
                />
              </Field>
              {canFill && (
                <Field label={t('fill.title')} help={t('fill.help')} stack>
                  <div className="space-y-3">
                    <Segmented
                      label={t('fill.title')}
                      value={fill.level}
                      options={FILL_LEVELS.map((level) => ({ value: level, label: t(`fill.level.${level}`) }))}
                      onChange={(level) => onChoice({ fillLight: { ...fill, level } })}
                    />
                    {fill.level !== 'off' && (
                      <>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-[13px] text-muted">{t('fill.tint')}</span>
                          <Segmented
                            size="sm"
                            label={t('fill.tint')}
                            value={fill.tint}
                            options={FILL_TINTS.map((tint) => ({ value: tint, label: t(`fill.tints.${tint}`) }))}
                            onChange={(tint) => onChoice({ fillLight: { ...fill, tint } })}
                          />
                        </div>
                        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted">
                          <Sun className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          {t('fill.brightness')}
                        </p>
                      </>
                    )}
                  </div>
                </Field>
              )}
              <Field label={t('mirror')} help={t('mirrorHelp')}>
                <Toggle checked={choice.mirror} onChange={(mirror) => onChoice({ mirror })} label={t('mirror')} />
              </Field>
              {capture360 && <Capture360 {...capture360} />}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface Capture360Props {
  motion: { enabled: boolean; threshold: number };
  onMotion: (m: { enabled: boolean; threshold: number }) => void;
  takes: LocalTake[];
  onImport: (files: FileList) => void;
  storeBackend: 'opfs' | 'idb' | null;
  importIcon: ReactNode;
}

/** 360 booth only: the motion trigger (CAP-4), video import (CAP-12) and the takes on this device. */
function Capture360({ motion: motionSettings, onMotion, takes, onImport, storeBackend, importIcon }: Capture360Props) {
  const t = useTranslations('booth.settings');
  const locale = useLocale();
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <Field label={t('motion')} help={t('motionHelp')}>
        <Toggle
          checked={motionSettings.enabled}
          onChange={(enabled) => onMotion({ ...motionSettings, enabled })}
          label={t('motion')}
        />
      </Field>
      {motionSettings.enabled && (
        <Field label={t('sensitivity')} stack>
          <Slider
            label={t('sensitivity')}
            value={Math.round(motionSettings.threshold * 100)}
            min={1}
            max={60}
            unit="%"
            onChange={(n) => onMotion({ ...motionSettings, threshold: n / 100 })}
          />
        </Field>
      )}
      <Field label={t('import')} help={t('importHelp')}>
        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          multiple
          className="sr-only"
          aria-label={t('import')}
          onChange={(e) => {
            if (e.target.files?.length) onImport(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="focus-ring inline-flex h-9 items-center gap-2 rounded-[10px] border border-line-strong bg-elev px-3.5 text-sm font-medium shadow-card hover:bg-sunken"
        >
          {importIcon}
          {t('chooseFiles')}
        </button>
      </Field>
      <div className="py-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">{t('takes')}</h3>
          {storeBackend && <span className="text-[12px] text-faint">{t(`backend.${storeBackend}`)}</span>}
        </div>
        {takes.length === 0 ? (
          <p className="text-[13px] text-muted">{t('noTakes')}</p>
        ) : (
          <ul className="space-y-2">
            {takes.slice(0, 12).map((tk2) => (
              <li key={tk2.id} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-muted">{formatRelative(new Date(tk2.capturedAt), locale)}</span>
                <span className="tabular text-faint">
                  {(tk2.durationMs / 1000).toFixed(1)} s · {formatBytes(tk2.bytes, locale)}
                </span>
                <TakeBadges take={tk2} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
