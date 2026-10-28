'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { LiveBackground } from '@immersia/render-engine/background';
import { GradePreview } from '@immersia/render-engine/preview';
import type { Background, BoothMode } from '@immersia/shared';
import { Card, ColorField, Field, Segmented } from '@immersia/ui';
import { patchMediaAction } from '@/app/studio/design-actions';
import { sampleMask, sampleScene } from '@/lib/sample-image';
import type { AssetView } from '@/server/assets';
import { useAutosave } from '../setup/use-autosave';
import { MediaSlot } from './MediaSlot';

type Mode = 'off' | 'blur' | 'colour' | 'image';
const DEFAULT_COLOUR = '#1fa37a';
const PREVIEW = { width: 240, height: 300 };

const modeOf = (b: Background): Mode => (!b ? 'off' : 'blur' in b ? 'blur' : 'color' in b ? 'colour' : 'image');

/** The background as the preview can draw it. A picture or video is read from its (signed) URL into this page. */
function usePreviewBackground(value: Background, asset: AssetView | null): LiveBackground | null {
  const color = value && 'color' in value ? value.color : null;
  const blur = Boolean(value && 'blur' in value);
  const url = value && 'assetId' in value ? (asset?.url ?? null) : null;
  const mime = asset?.mime ?? '';
  const [loaded, setLoaded] = useState<{ url: string; value: LiveBackground } | null>(null);

  useEffect(() => {
    if (!url) return;
    let live = true;
    let cleanup = () => {};
    void (async () => {
      const res = await fetch(url).catch(() => null);
      const blob = res?.ok ? await res.blob() : null;
      if (!blob || !live) return;
      if (mime.startsWith('video/')) {
        const objectUrl = URL.createObjectURL(blob);
        const el = document.createElement('video');
        el.muted = true;
        el.loop = true;
        el.playsInline = true;
        el.src = objectUrl;
        void el.play().catch(() => undefined);
        cleanup = () => {
          el.pause();
          el.removeAttribute('src');
          el.load();
          URL.revokeObjectURL(objectUrl);
        };
        if (live) setLoaded({ url, value: { kind: 'video', video: el } });
        else cleanup();
      } else {
        const image = await createImageBitmap(blob).catch(() => null);
        if (!image) return;
        cleanup = () => image.close();
        if (live) setLoaded({ url, value: { kind: 'image', image, width: image.width, height: image.height } });
        else cleanup();
      }
    })();
    return () => {
      live = false;
      cleanup();
    };
  }, [url, mime]);

  if (color) return { kind: 'color', color };
  if (blur) return { kind: 'blur' };
  return url && loaded?.url === url ? loaded.value : null;
}

/**
 * The background on the sample scene with a drawn silhouette of its two people as the mask (a real mask needs
 * a real guest), through the same stage the booth and the renders use.
 */
function BackgroundPreview({ background, label }: { background: LiveBackground | null; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const preview = useRef<GradePreview | null>(null);

  // One WebGL context for the life of the canvas (a canvas cannot get a context back once it was lost).
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    try {
      preview.current = new GradePreview(canvas, PREVIEW.width, PREVIEW.height);
    } catch {
      preview.current = null; // no WebGL2 here: the controls still work
    }
    return () => {
      preview.current?.dispose();
      preview.current = null;
    };
  }, []);

  useEffect(() => {
    const p = preview.current;
    if (!p) return;
    p.configure({ look: null, effects: [], background });
    p.setMask(sampleMask(PREVIEW.width, PREVIEW.height), { reset: true });
    const scene = sampleScene(PREVIEW.width, PREVIEW.height);
    let raf = 0;
    const draw = () => {
      p.draw(scene);
      if (background?.kind === 'video') raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [background]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className="h-[300px] w-[240px] max-w-full shrink-0 rounded-xl bg-sunken"
    />
  );
}

function BoothBackground({
  booth,
  value,
  onChange,
  view,
  remember,
  readOnly,
}: {
  booth: BoothMode;
  value: Background;
  onChange: (b: Background) => void;
  view: (id: string | null | undefined) => AssetView | null;
  remember: (a: AssetView) => void;
  readOnly: boolean;
}) {
  const t = useTranslations('studio.branding.background');
  const [mode, setMode] = useState<Mode>(() => modeOf(value));
  const asset = value && 'assetId' in value ? view(value.assetId) : null;
  const photo = booth === 'photo';
  const label = t(photo ? 'photo' : 'video');
  const live = usePreviewBackground(value, asset);

  const choose = (next: Mode) => {
    setMode(next);
    if (next === 'off') onChange(null);
    else if (next === 'blur') onChange({ blur: true });
    else if (next === 'colour') onChange({ color: value && 'color' in value ? value.color : DEFAULT_COLOUR });
    // A picture is chosen from the library below; until then nothing is replaced.
    else if (!(value && 'assetId' in value)) onChange(null);
  };

  return (
    <Field label={label} stack>
      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-3">
          <Segmented
            value={mode}
            onChange={choose}
            label={label}
            options={[
              { value: 'off', label: t('off') },
              { value: 'blur', label: t('blur') },
              { value: 'colour', label: t('colour') },
              { value: 'image', label: t(photo ? 'image' : 'imageOrVideo') },
            ]}
          />
          {mode === 'colour' && value && 'color' in value && (
            <ColorField value={value.color} label={t('colourLabel')} onChange={(color) => onChange({ color })} />
          )}
          {mode === 'image' && (
            <MediaSlot
              label={t(photo ? 'image' : 'imageOrVideo')}
              help={t(photo ? 'photoImageHelp' : 'imageHelp')}
              types={['background']}
              accept={photo ? (a) => a.mime.startsWith('image/') : undefined}
              asset={asset}
              readOnly={readOnly}
              onPick={(a) => {
                remember(a);
                onChange({ assetId: a.id });
              }}
              onRemove={() => onChange(null)}
            />
          )}
          {mode === 'image' && !asset && <p className="text-[13px] text-faint">{t('needsImage')}</p>}
          <p className="max-w-prose text-[13px] leading-relaxed text-faint">{t('previewNote')}</p>
        </div>
        <BackgroundPreview background={live} label={t('preview')} />
      </div>
    </Field>
  );
}

/** Screen 5, "background replacement" (CAP-10): per booth, off, a blur, a colour or a picture (or, for 360, a video). */
export function BackgroundCard({
  eventId,
  booths,
  readOnly,
  initial,
  view,
  remember,
}: {
  eventId: string;
  booths: BoothMode[];
  readOnly: boolean;
  initial: { background: Background; photoBackground: Background };
  view: (id: string | null | undefined) => AssetView | null;
  remember: (a: AssetView) => void;
}) {
  const t = useTranslations('studio.branding.background');
  const [value, setValue] = useState(initial);
  const video = booths.includes('video360');
  const photo = booths.includes('photo');
  useAutosave(value, async (v) => {
    const patch = {
      ...(video ? { background: v.background } : {}),
      ...(photo ? { photoBackground: v.photoBackground } : {}),
    };
    return (await patchMediaAction(eventId, patch)).ok;
  });

  return (
    <Card title={t('title')} subtitle={t('subtitle')}>
      <fieldset disabled={readOnly} className="min-w-0 divide-y divide-line">
        {video && (
          <BoothBackground
            booth="video360"
            value={value.background}
            onChange={(background) => setValue((v) => ({ ...v, background }))}
            view={view}
            remember={remember}
            readOnly={readOnly}
          />
        )}
        {photo && (
          <BoothBackground
            booth="photo"
            value={value.photoBackground}
            onChange={(photoBackground) => setValue((v) => ({ ...v, photoBackground }))}
            view={view}
            remember={remember}
            readOnly={readOnly}
          />
        )}
      </fieldset>
    </Card>
  );
}
