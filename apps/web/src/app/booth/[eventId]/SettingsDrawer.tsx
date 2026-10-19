'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'motion/react';
import { Flashlight, X } from 'lucide-react';
import { listCameras, type CameraInfo } from '@immersia/capture';
import type { LocalTake } from '@immersia/offline';
import { Field, IconButton, Select, Slider, Toggle, softSpring } from '@immersia/ui';
import { formatBytes, formatRelative } from '@/lib/format';
import type { ActiveCamera } from './Booth360';
import { TakeBadges } from './TakeBadges';

export interface CameraChoice {
  source: 'camera' | 'simulator';
  deviceId: string | null;
  /** Mirror the on-screen preview only (front cameras feel natural mirrored). */
  mirror: boolean;
}

const KEY = 'immersia.booth.camera.v1';

export function readCameraChoice(): CameraChoice {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<CameraChoice> | null;
    if (v && (v.source === 'camera' || v.source === 'simulator'))
      return { source: v.source, deviceId: v.deviceId ?? null, mirror: Boolean(v.mirror) };
  } catch {
    // Storage unavailable: fall through to the default.
  }
  return { source: 'camera', deviceId: null, mirror: false };
}

function saveCameraChoice(c: CameraChoice) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // The choice still applies for this session.
  }
}

const SIMULATOR = '__simulator__';
const DEFAULT = '__default__';

export function SettingsDrawer({
  open,
  onClose,
  choice,
  onChoice,
  camera,
  motion: motionSettings,
  onMotion,
  takes,
  onImport,
  storeBackend,
  importIcon,
}: {
  open: boolean;
  onClose: () => void;
  choice: CameraChoice;
  onChoice: (c: CameraChoice) => void;
  camera: ActiveCamera | null;
  motion: { enabled: boolean; threshold: number };
  onMotion: (m: { enabled: boolean; threshold: number }) => void;
  takes: LocalTake[];
  onImport: (files: FileList) => void;
  storeBackend: 'opfs' | 'idb' | null;
  importIcon: ReactNode;
}) {
  const t = useTranslations('booth.settings');
  const locale = useLocale();
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [torch, setTorch] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listCameras().then((list) => {
      if (!cancelled) setCameras(list);
    });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const update = (patch: Partial<CameraChoice>) => {
    const next = { ...choice, ...patch };
    saveCameraChoice(next);
    onChoice(next);
  };

  const selected = choice.source === 'simulator' ? SIMULATOR : (choice.deviceId ?? DEFAULT);
  const options = [
    { value: DEFAULT, label: t('defaultCamera') },
    ...cameras.map((c) => ({
      value: c.deviceId,
      label: c.lens !== 'unknown' ? `${c.label} · ${t(`lens.${c.lens}`)}` : c.label,
    })),
    { value: SIMULATOR, label: t('simulator') },
  ];

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
                <Select
                  label={t('camera')}
                  value={selected}
                  options={options}
                  onChange={(v) =>
                    update(
                      v === SIMULATOR
                        ? { source: 'simulator', deviceId: null }
                        : { source: 'camera', deviceId: v === DEFAULT ? null : v },
                    )
                  }
                />
                {camera && (
                  <p className="text-[13px] text-muted">
                    {t('delivering', { width: camera.width, height: camera.height, fps: camera.frameRate })}
                  </p>
                )}
              </Field>
              <Field label={t('mirror')} help={t('mirrorHelp')}>
                <Toggle checked={choice.mirror} onChange={(mirror) => update({ mirror })} label={t('mirror')} />
              </Field>
              {camera?.torch.supported && (
                <Field label={t('torch')}>
                  <Toggle
                    checked={torch}
                    label={t('torch')}
                    onChange={async (on) => {
                      if (await camera.torch.set(on)) setTorch(on);
                    }}
                  />
                </Field>
              )}
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
            </div>
            {camera?.torch.supported === false && choice.source === 'camera' && (
              <p className="flex items-center gap-2 border-t border-line px-6 py-3 text-[12px] text-faint">
                <Flashlight className="size-3.5" aria-hidden /> {t('noTorch')}
              </p>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
