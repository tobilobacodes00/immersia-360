'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { EFFECTS, LOOKS, PHOTO_EFFECTS, StillRunner, type ColorMode } from '@immersia/effects';
import { GradePreview } from '@immersia/render-engine/preview';
import type { BoothMode } from '@immersia/shared';
import { Card, Field, Segmented, Slider, Toggle, cx } from '@immersia/ui';
import { patchMediaAction } from '@/app/studio/design-actions';
import { sampleScene } from '@/lib/sample-image';
import { useAutosave } from '../setup/use-autosave';

type Effect = { id: string; intensity: number; colorMode?: ColorMode };
const MAX_EFFECTS = 8;
const THUMB = { width: 120, height: 150 };

/** Thumbnails of every look and photo effect on the sample scene, rendered once with the real shaders. */
function useThumbnails() {
  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    void (async () => {
      const scene = sampleScene(THUMB.width * 2, THUMB.height * 2);
      const runner = new StillRunner();
      const out = new Map<string, string>();
      try {
        for (const look of LOOKS) {
          const blob = await runner.toBlob(scene, {
            look,
            lookIntensity: 1,
            width: THUMB.width * 2,
            height: THUMB.height * 2,
          });
          const url = URL.createObjectURL(blob);
          urls.push(url);
          out.set(`look:${look.id}`, url);
        }
        for (const effect of PHOTO_EFFECTS) {
          const blob = await runner.toBlob(scene, {
            effect,
            effectIntensity: 1,
            width: THUMB.width * 2,
            height: THUMB.height * 2,
          });
          const url = URL.createObjectURL(blob);
          urls.push(url);
          out.set(`photo:${effect.id}`, url);
        }
      } catch {
        // No WebGL2 here: the pickers still work, with names instead of pictures.
      } finally {
        runner.dispose();
      }
      if (live) setThumbs(out);
    })();
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);
  return thumbs;
}

function Picker({
  label,
  items,
  value,
  onChange,
  thumb,
  disabled,
}: {
  label: string;
  items: readonly { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
  thumb: (id: string) => string | undefined;
  disabled: boolean;
}) {
  const current = value ?? 'none';
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
      {items.map((item) => {
        const selected = item.id === current;
        const src = thumb(item.id);
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(item.id === 'none' ? null : item.id)}
            className={cx(
              'focus-ring group relative flex flex-col overflow-hidden rounded-xl border text-left transition-colors',
              selected ? 'border-accent ring-2 ring-accent-soft' : 'border-line hover:border-line-strong',
            )}
          >
            <span className="block aspect-[4/5] bg-sunken">
              {src && (
                // eslint-disable-next-line @next/next/no-img-element -- a local object URL
                <img src={src} alt="" className="size-full object-cover" />
              )}
            </span>
            <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-[12px]">
              <span className="truncate">{item.name}</span>
              {selected && <Check className="size-3.5 shrink-0 text-accent" aria-hidden />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The 360 effects, animated on the sample scene with a 120 BPM pulse: exactly what the render does. */
function EffectsPreview({ look, effects, label }: { look: string | null; effects: Effect[]; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const preview = useRef<GradePreview | null>(null);
  const settings = useMemo(
    () => ({
      look: look ? { id: look, intensity: 1 } : null,
      effects: effects.map((e) => ({ id: e.id, intensity: e.intensity, colorMode: e.colorMode ?? null })),
      seed: 7,
    }),
    [look, effects],
  );
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    try {
      preview.current = new GradePreview(canvas, 240, 300);
    } catch {
      preview.current = null;
    }
    return () => {
      preview.current?.dispose();
      preview.current = null;
    };
  }, []);
  useEffect(() => {
    const p = preview.current;
    if (!p) return;
    p.configure(settings);
    const scene = sampleScene(240, 300);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      const phase = (t / 0.5) % 1;
      p.draw(scene, { time: t % 8, duration: 8, beat: phase, pulse: Math.exp(-4 * phase) });
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [settings]);
  return <canvas ref={ref} role="img" aria-label={label} className="h-[300px] w-[240px] rounded-xl bg-sunken" />;
}

/** Screen 5, "filter, effects with colour modes" (VID-7, VID-11, VID-12, PHO-10). */
export function LooksCard({
  eventId,
  booths,
  readOnly,
  hasMusic,
  initial,
}: {
  eventId: string;
  booths: BoothMode[];
  readOnly: boolean;
  hasMusic: boolean;
  initial: {
    filterId: string | null;
    effects: Effect[];
    beatSync: boolean;
    photoFilterId: string | null;
    photoEffectId: string | null;
  };
}) {
  const t = useTranslations('studio.branding.looks');
  const thumbs = useThumbnails();
  const [value, setValue] = useState(initial);
  useAutosave(value, async (v) => (await patchMediaAction(eventId, v)).ok);
  const set = (patch: Partial<typeof value>) => setValue((v) => ({ ...v, ...patch }));
  const toggleEffect = (id: string) =>
    set({
      effects: value.effects.some((e) => e.id === id)
        ? value.effects.filter((e) => e.id !== id)
        : value.effects.length >= MAX_EFFECTS
          ? value.effects
          : [...value.effects, { id, intensity: EFFECTS.find((d) => d.id === id)?.defaultIntensity ?? 1 }],
    });
  const setEffect = (id: string, patch: Partial<Effect>) =>
    set({ effects: value.effects.map((e) => (e.id === id ? { ...e, ...patch } : e)) });

  const video = booths.includes('video360');
  const photo = booths.includes('photo');
  return (
    <Card title={t('title')} subtitle={t('subtitle')}>
      <fieldset disabled={readOnly} className="min-w-0 divide-y divide-line">
        {video && (
          <Field label={t(photo ? 'videoLook' : 'look')} help={t('lookHelp')} stack>
            <Picker
              label={t(photo ? 'videoLook' : 'look')}
              items={LOOKS}
              value={value.filterId}
              onChange={(filterId) => set({ filterId })}
              thumb={(id) => thumbs.get(`look:${id}`)}
              disabled={readOnly}
            />
          </Field>
        )}
        {video && (
          <Field label={t('effects')} help={t('effectsHelp', { max: MAX_EFFECTS })} stack>
            <div className="flex flex-col gap-5 lg:flex-row">
              <div className="min-w-0 flex-1 space-y-4">
                <div className="flex flex-wrap gap-2" role="group" aria-label={t('effects')}>
                  {EFFECTS.map((def) => {
                    const on = value.effects.some((e) => e.id === def.id);
                    return (
                      <button
                        key={def.id}
                        type="button"
                        aria-pressed={on}
                        disabled={readOnly || (!on && value.effects.length >= MAX_EFFECTS)}
                        onClick={() => toggleEffect(def.id)}
                        className={cx(
                          'focus-ring rounded-full border px-3 py-1.5 text-[13px] transition-colors disabled:opacity-50',
                          on ? 'border-accent bg-accent-soft text-fg' : 'border-line hover:border-line-strong',
                        )}
                      >
                        {def.name}
                      </button>
                    );
                  })}
                </div>
                {value.effects.map((e) => {
                  const def = EFFECTS.find((d) => d.id === e.id);
                  if (!def) return null;
                  return (
                    <div key={e.id} className="rounded-xl border border-line p-3">
                      <div className="mb-2 text-sm font-medium">{def.name}</div>
                      <div className="flex flex-wrap items-center gap-4">
                        <Slider
                          value={Math.round(e.intensity * 100)}
                          min={0}
                          max={100}
                          unit="%"
                          width="w-56 max-w-full"
                          label={t('strength', { effect: def.name })}
                          onChange={(v) => setEffect(e.id, { intensity: v / 100 })}
                        />
                        {def.colorModes && (
                          <Segmented
                            size="sm"
                            value={e.colorMode ?? def.colorModes[0]!}
                            label={t('colourMode', { effect: def.name })}
                            onChange={(colorMode) => setEffect(e.id, { colorMode })}
                            options={def.colorModes.map((m) => ({ value: m, label: t(`modes.${m}`) }))}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <EffectsPreview look={value.filterId} effects={value.effects} label={t('preview')} />
            </div>
          </Field>
        )}
        {video && (
          <Field label={t('beatSync')} help={hasMusic ? t('beatSyncHelp') : t('beatSyncNeedsMusic')}>
            <Toggle
              checked={value.beatSync && hasMusic}
              disabled={!hasMusic}
              label={t('beatSync')}
              onChange={(beatSync) => set({ beatSync })}
            />
          </Field>
        )}
        {photo && (
          <Field label={t(video ? 'photoLook' : 'look')} help={t('lookHelp')} stack>
            <Picker
              label={t(video ? 'photoLook' : 'look')}
              items={LOOKS}
              value={value.photoFilterId}
              onChange={(photoFilterId) => set({ photoFilterId })}
              thumb={(id) => thumbs.get(`look:${id}`)}
              disabled={readOnly}
            />
          </Field>
        )}
        {photo && (
          <Field label={t('photoEffect')} help={t('photoEffectHelp')} stack>
            <Picker
              label={t('photoEffect')}
              items={PHOTO_EFFECTS}
              value={value.photoEffectId}
              onChange={(photoEffectId) => set({ photoEffectId })}
              thumb={(id) => thumbs.get(`photo:${id}`)}
              disabled={readOnly}
            />
          </Field>
        )}
      </fieldset>
    </Card>
  );
}
