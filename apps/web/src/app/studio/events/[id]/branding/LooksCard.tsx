'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations, type Messages } from 'next-intl';
import { Check } from 'lucide-react';
import {
  EFFECTS,
  LOOKS,
  PHOTO_EFFECTS,
  StillRunner,
  type ColorMode,
  type StillEncodeOptions,
  type StillSource,
} from '@immersia/effects';
import type { BoothMode } from '@immersia/shared';
import { Card, Field, Segmented, Slider, Toggle, cx, useRadioGroup } from '@immersia/ui';
import { mountPreview } from '@/lib/grade-canvas';
import { sampleScene } from '@/lib/sample-image';
import { SaveIndicator } from '../setup/EventSetup';
import type { SaveStatus } from '../setup/use-autosave';

type Effect = { id: string; intensity: number; colorMode?: ColorMode };

/** What the card edits; the branding screen keeps it, saves it and shows the save status. */
export interface LooksValue {
  filterId: string | null;
  effects: Effect[];
  beatSync: boolean;
  photoFilterId: string | null;
  photoEffectId: string | null;
}

/** Every look and effect id has a name in each catalogue (checked by effect-names.test.ts). */
type LookKey = keyof Messages['effects']['looks'];
type PhotoEffectKey = keyof Messages['effects']['photo'];
type VideoEffectKey = keyof Messages['effects']['video'];
const MAX_EFFECTS = 8;
const THUMB = { width: 120, height: 150 };

/**
 * Thumbnails of the looks and photo effects on the sample scene, rendered with the real shaders; only the
 * groups the event's booths show are made. Stops as soon as the card goes away: no more renders, and no
 * object URL is created after that.
 */
function useThumbnails({ looks: wantLooks, photo: wantPhoto }: { looks: boolean; photo: boolean }) {
  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    if (!wantLooks && !wantPhoto) return;
    let live = true;
    const urls: string[] = [];
    void (async () => {
      const runner = new StillRunner();
      const out = new Map<string, string>();
      const size = { width: THUMB.width * 2, height: THUMB.height * 2 };
      /** Render one thumbnail; false when the card went away meanwhile. */
      const add = async (key: string, scene: StillSource, opts: StillEncodeOptions) => {
        const blob = await runner.toBlob(scene, { ...opts, ...size });
        if (!live) return false;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        out.set(key, url);
        return true;
      };
      try {
        const scene = sampleScene(size.width, size.height);
        if (wantLooks) {
          for (const look of LOOKS) {
            if (!live || !(await add(`look:${look.id}`, scene, { look, lookIntensity: 1 }))) break;
          }
          if (live) setThumbs(new Map(out));
        }
        if (wantPhoto) {
          for (const effect of PHOTO_EFFECTS) {
            if (!live || !(await add(`photo:${effect.id}`, scene, { effect, effectIntensity: 1 }))) break;
          }
          if (live) setThumbs(new Map(out));
        }
      } catch {
        // No WebGL2 here: the pickers still work, with names instead of pictures.
      } finally {
        runner.dispose();
      }
    })();
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [wantLooks, wantPhoto]);
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
  const radios = useRadioGroup({
    values: items.map((item) => item.id),
    value: current,
    onChange: (id) => onChange(id === 'none' ? null : id),
    isDisabled: () => disabled,
  });
  return (
    <div {...radios.group} aria-label={label} className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
      {items.map((item) => {
        const selected = item.id === current;
        const src = thumb(item.id);
        return (
          <button
            key={item.id}
            type="button"
            {...radios.item(item.id)}
            disabled={disabled}
            className={cx(
              // The selection is the border, the tint and the check mark; a ring here would replace the
              // keyboard focus ring (both are box-shadows, and a utility beats the component layer).
              'focus-ring group relative flex flex-col overflow-hidden rounded-xl border text-left transition-colors',
              selected ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong',
            )}
          >
            <span className="block aspect-[4/5] bg-sunken">
              {src && (
                // eslint-disable-next-line @next/next/no-img-element -- a local object URL
                <img src={src} alt="" className="size-full object-cover" />
              )}
            </span>
            <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-[12px]">
              <span className={cx('truncate', selected && 'font-semibold')}>{item.name}</span>
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
  const t = useTranslations('studio.branding.looks');
  const host = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const settings = useMemo(
    () => ({
      look: look ? { id: look, intensity: 1 } : null,
      effects: effects.map((e) => ({ id: e.id, intensity: e.intensity, colorMode: e.colorMode ?? null })),
      seed: 7,
    }),
    [look, effects],
  );
  const latest = useRef(settings);
  useEffect(() => {
    latest.current = settings;
  });

  // One loop for the card's life. Everything that can fail (no WebGL2, no OffscreenCanvas, a shader this
  // GPU rejects) happens in its frames and ends in "unavailable": a preview must never take the page down,
  // and the choice itself is still saved.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let mounted: ReturnType<typeof mountPreview> = null;
    let scene: ReturnType<typeof sampleScene> | null = null;
    let applied: typeof settings | null = null;
    let raf = 0;
    let dead = false;
    const fail = (err?: unknown) => {
      if (err) console.warn('[looks] preview unavailable', err);
      dead = true;
      mounted?.destroy();
      mounted = null;
      setUnavailable(true);
    };
    const frame = (now: number) => {
      if (dead) return;
      try {
        if (!mounted) {
          mounted = mountPreview(el, 240, 300);
          if (!mounted) return fail();
          scene = sampleScene(240, 300);
        }
        const changed = applied !== latest.current;
        if (changed) {
          applied = latest.current;
          mounted.preview.configure(applied);
        }
        // Reduced motion: one still frame per change of settings, not a loop of drawing.
        if (!still || changed) {
          const t = (now - start) / 1000;
          const phase = (t / 0.5) % 1;
          mounted.preview.draw(scene!, { time: t % 8, duration: 8, beat: phase, pulse: Math.exp(-4 * phase) });
        }
      } catch (err) {
        return fail(err);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      mounted?.destroy();
      mounted = null;
    };
  }, []);

  return (
    <div className="relative h-[300px] w-[240px] shrink-0">
      <div ref={host} role="img" aria-label={label} className="size-full overflow-hidden rounded-xl bg-sunken" />
      {unavailable && (
        <p className="absolute inset-0 grid place-items-center p-4 text-center text-[13px] leading-relaxed text-muted">
          {t('previewUnavailable')}
        </p>
      )}
    </div>
  );
}

/** Screen 5, "filter, effects with colour modes" (VID-7, VID-11, VID-12, PHO-10). */
export function LooksCard({
  booths,
  readOnly,
  hasMusic,
  value,
  onChange,
  status,
}: {
  booths: BoothMode[];
  readOnly: boolean;
  hasMusic: boolean;
  value: LooksValue;
  onChange: (patch: Partial<LooksValue>) => void;
  /** The state of saving `value` (the branding screen owns the autosave). */
  status: SaveStatus;
}) {
  const t = useTranslations('studio.branding.looks');
  const names = useTranslations('effects');
  const looks = LOOKS.map((l) => ({ id: l.id, name: names(`looks.${l.id as LookKey}`) }));
  const photoEffects = PHOTO_EFFECTS.map((e) => ({ id: e.id, name: names(`photo.${e.id as PhotoEffectKey}`) }));
  const effectName = (id: string) => names(`video.${id as VideoEffectKey}`);
  const video = booths.includes('video360');
  const photo = booths.includes('photo');
  const thumbs = useThumbnails({ looks: video || photo, photo });
  const toggleEffect = (id: string) =>
    onChange({
      effects: value.effects.some((e) => e.id === id)
        ? value.effects.filter((e) => e.id !== id)
        : value.effects.length >= MAX_EFFECTS
          ? value.effects
          : [...value.effects, { id, intensity: EFFECTS.find((d) => d.id === id)?.defaultIntensity ?? 1 }],
    });
  const setEffect = (id: string, patch: Partial<Effect>) =>
    onChange({ effects: value.effects.map((e) => (e.id === id ? { ...e, ...patch } : e)) });

  return (
    <Card title={t('title')} subtitle={t('subtitle')} action={<SaveIndicator statuses={[status]} />}>
      <fieldset disabled={readOnly} className="min-w-0 divide-y divide-line">
        {video && (
          <Field label={t(photo ? 'videoLook' : 'look')} help={t('lookHelp')} stack>
            <Picker
              label={t(photo ? 'videoLook' : 'look')}
              items={looks}
              value={value.filterId}
              onChange={(filterId) => onChange({ filterId })}
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
                        {effectName(def.id)}
                      </button>
                    );
                  })}
                </div>
                {value.effects.map((e) => {
                  const def = EFFECTS.find((d) => d.id === e.id);
                  if (!def) return null;
                  return (
                    <div key={e.id} className="rounded-xl border border-line p-3">
                      <div className="mb-2 text-sm font-medium">{effectName(def.id)}</div>
                      <div className="flex flex-wrap items-center gap-4">
                        <Slider
                          value={Math.round(e.intensity * 100)}
                          min={0}
                          max={100}
                          unit="%"
                          width="w-56 max-w-full"
                          label={t('strength', { effect: effectName(def.id) })}
                          onChange={(v) => setEffect(e.id, { intensity: v / 100 })}
                        />
                        {def.colorModes && (
                          <Segmented
                            size="sm"
                            value={e.colorMode ?? def.colorModes[0]!}
                            label={t('colourMode', { effect: effectName(def.id) })}
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
              onChange={(beatSync) => onChange({ beatSync })}
            />
          </Field>
        )}
        {photo && (
          <Field label={t(video ? 'photoLook' : 'look')} help={t('lookHelp')} stack>
            <Picker
              label={t(video ? 'photoLook' : 'look')}
              items={looks}
              value={value.photoFilterId}
              onChange={(photoFilterId) => onChange({ photoFilterId })}
              thumb={(id) => thumbs.get(`look:${id}`)}
              disabled={readOnly}
            />
          </Field>
        )}
        {photo && (
          <Field label={t('photoEffect')} help={t('photoEffectHelp')} stack>
            <Picker
              label={t('photoEffect')}
              items={photoEffects}
              value={value.photoEffectId}
              onChange={(photoEffectId) => onChange({ photoEffectId })}
              thumb={(id) => thumbs.get(`photo:${id}`)}
              disabled={readOnly}
            />
          </Field>
        )}
      </fieldset>
    </Card>
  );
}
