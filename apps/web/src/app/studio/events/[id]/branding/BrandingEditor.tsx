'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, Film, Music } from 'lucide-react';
import type { Template } from '@immersia/layout';
import { buildSourceTimes } from '@immersia/render-engine/timeline';
import {
  THEME_PRESETS,
  brandingSchema,
  eventTokens,
  guestThemeVars,
  type BrandingSettings,
  type PhotoSettings,
  type Video360Settings,
} from '@immersia/shared';
import { Card, ColorField, Field, Pill, Segmented, Slider, TextInput, TokenField, cx } from '@immersia/ui';
import { updateSectionAction } from '@/app/studio/actions';
import { patchMediaAction } from '@/app/studio/design-actions';
import { AudioEditor, type MusicEdit } from '@/components/audio-editor/AudioEditor';
import type { AssetView } from '@/server/assets';
import type { TemplateSummary } from '@/server/templates';
import { SaveIndicator } from '../setup/EventSetup';
import { useAutosave } from '../setup/use-autosave';
import { DesignCard } from './DesignCard';
import { MediaSlot } from './MediaSlot';

type Music = NonNullable<Video360Settings['music']>;
const DEFAULT_MUSIC: Omit<Music, 'assetId'> = {
  trimStartMs: 0,
  trimEndMs: null,
  offsetMs: 0,
  fadeInMs: 500,
  fadeOutMs: 1000,
  volume: 0.9,
};
/** DL-4's QR end card, when the event shows one (seconds). */
const END_CARD_S = 2;

export interface BrandingEditorProps {
  eventId: string;
  mode: 'video360' | 'photo';
  readOnly: boolean;
  event: { name: string; date: string };
  branding: BrandingSettings;
  video: Video360Settings;
  photo: PhotoSettings;
  endFrameQr: boolean;
  design: { id: string; doc: Template } | null;
  library: TemplateSummary[];
  uploads: AssetView[];
  assets: AssetView[];
}

/** Screen 5: how the event looks (theme, logo, attract screen, dynamic fields) and its media. */
export function BrandingEditor(p: BrandingEditorProps) {
  const t = useTranslations('studio.branding');
  const router = useRouter();
  const [branding, setBranding] = useState(p.branding);
  const [views, setViews] = useState(() => new Map(p.assets.map((a) => [a.id, a])));
  const view = (id: string | null | undefined) => (id ? (views.get(id) ?? null) : null);
  const remember = (a: AssetView) => setViews((m) => new Map(m).set(a.id, a));

  const brandingStatus = useAutosave(branding, async (b) => (await updateSectionAction(p.eventId, 'branding', b)).ok, {
    isValid: (b) => brandingSchema.safeParse(b).success,
  });

  // Media references: intro/outro apply at once; music and card length are edited continuously.
  const [intro, setIntro] = useState(p.video.introAssetId);
  const [outro, setOutro] = useState(p.video.outroAssetId);
  const [media, setMedia] = useState({ cardSeconds: p.video.cardSeconds, music: p.video.music });
  const [mediaError, setMediaError] = useState(false);
  const mediaStatus = useAutosave(media, async (m) => (await patchMediaAction(p.eventId, m)).ok);
  const setRef = async (field: 'introAssetId' | 'outroAssetId', a: AssetView | null) => {
    if (a) remember(a);
    (field === 'introAssetId' ? setIntro : setOutro)(a?.id ?? null);
    const res = await patchMediaAction(p.eventId, { [field]: a?.id ?? null });
    setMediaError(!res.ok);
    if (res.ok) router.refresh();
  };

  // The song itself, for the waveform and the preview: one stable Blob per chosen asset.
  const musicView = view(media.music?.assetId);
  const [song, setSong] = useState<{ id: string; blob: Blob } | null>(null);
  useEffect(() => {
    if (!musicView || song?.id === musicView.id) return;
    let live = true;
    void fetch(musicView.url)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (live && blob) setSong({ id: musicView.id, blob });
      });
    return () => {
      live = false;
    };
  }, [musicView, song?.id]);

  // The video's real length: spin with slow motion and reverse, then the cards (VID-5, DL-4).
  const introView = view(intro);
  const outroView = view(outro);
  const outputSeconds = useMemo(() => {
    const v = p.video;
    const frames = buildSourceTimes({
      durationS: v.spinSeconds,
      outputFps: v.fps,
      slowMotion: v.slowMotion,
      reverse: v.reverse,
    }).length;
    const card = (a: AssetView | null) =>
      !a
        ? 0
        : a.mime.startsWith('image/')
          ? media.cardSeconds
          : Math.min(media.cardSeconds, (a.durationMs ?? 0) / 1000);
    return frames / v.fps + card(introView) + card(outroView) + (p.endFrameQr ? END_CARD_S : 0);
  }, [p.video, p.endFrameQr, media.cardSeconds, introView, outroView]);

  const tokens = useMemo(() => eventTokens(p.event, branding), [p.event, branding]);
  const theme = branding.theme;
  const setTheme = (patch: Partial<BrandingSettings['theme']>) =>
    setBranding((b) => ({ ...b, theme: { ...b.theme, ...patch } }));
  const setAttract = (patch: Partial<BrandingSettings['attract']>) =>
    setBranding((b) => ({ ...b, attract: { ...b.attract, ...patch } }));

  return (
    <fieldset disabled={p.readOnly} className="min-w-0 space-y-6">
      <legend className="sr-only">{t('title')}</legend>
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-3">
        {p.readOnly ? <Pill>{t('readOnly')}</Pill> : <span />}
        <SaveIndicator statuses={[brandingStatus, mediaStatus, ...(mediaError ? (['error'] as const) : [])]} />
      </div>

      <Card title={t('theme.title')} subtitle={t('theme.subtitle')}>
        <Field label={t('theme.presets')} stack>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('theme.presets')}>
            {THEME_PRESETS.map((preset) => {
              const active =
                preset.theme.accent === theme.accent &&
                preset.theme.background === theme.background &&
                preset.theme.ink === theme.ink &&
                preset.theme.font === theme.font;
              return (
                <button
                  key={preset.name}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTheme(preset.theme)}
                  className={cx(
                    'focus-ring flex items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-1.5 text-[13px] transition-colors',
                    active ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong',
                  )}
                >
                  <span
                    className="grid size-6 place-items-center rounded-full ring-1 ring-black/10"
                    style={{ background: preset.theme.background }}
                    aria-hidden
                  >
                    <span className="size-3 rounded-full" style={{ background: preset.theme.accent }} />
                  </span>
                  {t(`theme.names.${preset.name}` as 'theme.names.Cobalt')}
                  {active && <Check className="size-3.5 text-accent" aria-hidden />}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label={t('theme.accent')}>
          <ColorField value={theme.accent} label={t('theme.accent')} onChange={(accent) => setTheme({ accent })} />
        </Field>
        <Field label={t('theme.background')}>
          <ColorField
            value={theme.background}
            label={t('theme.background')}
            onChange={(background) => setTheme({ background })}
          />
        </Field>
        <Field label={t('theme.ink')}>
          <ColorField value={theme.ink} label={t('theme.ink')} onChange={(ink) => setTheme({ ink })} />
        </Field>
        <Field label={t('theme.font')}>
          <Segmented
            value={theme.font}
            onChange={(font) => setTheme({ font })}
            label={t('theme.font')}
            options={[
              { value: 'sans', label: t('theme.sans') },
              { value: 'serif', label: t('theme.serif') },
            ]}
          />
        </Field>
        {/* A live sample of the guest screens in this theme. */}
        <div className="pb-4">
          <div
            style={guestThemeVars(theme)}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-g-bg px-5 py-4 text-g-ink ring-1 ring-black/5"
          >
            <span className={cx('text-[22px] tracking-[-0.03em]', theme.font === 'serif' ? 'font-serif' : 'font-bold')}>
              {branding.attract.headline || p.event.name}
            </span>
            <span className="rounded-full bg-g-accent px-5 py-2 text-sm font-semibold text-g-on-accent">
              {branding.attract.cta || t('attract.ctaPlaceholder')}
            </span>
          </div>
        </div>
      </Card>

      <Card title={t('attract.title')} subtitle={t('attract.subtitle')}>
        <MediaSlot
          label={t('logo.label')}
          help={t('logo.help')}
          types={['logo']}
          asset={view(branding.logoAssetId)}
          readOnly={p.readOnly}
          onPick={(a) => {
            remember(a);
            setBranding((b) => ({ ...b, logoAssetId: a.id }));
          }}
          onRemove={() => setBranding((b) => ({ ...b, logoAssetId: null }))}
        />
        <Field label={t('attract.headline')} htmlFor="attract-headline">
          <TextInput
            id="attract-headline"
            value={branding.attract.headline}
            onChange={(headline) => setAttract({ headline: headline.slice(0, 120) })}
            className="w-72 max-w-full"
          />
        </Field>
        <Field label={t('attract.subline')} stack>
          <TokenField
            label={t('attract.subline')}
            value={branding.attract.subline}
            ctx={tokens}
            onChange={(subline) => setAttract({ subline: subline.slice(0, 200) })}
          />
        </Field>
        <Field label={t('attract.cta')} htmlFor="attract-cta">
          <TextInput
            id="attract-cta"
            value={branding.attract.cta}
            onChange={(cta) => setAttract({ cta: cta.slice(0, 60) })}
            className="w-72 max-w-full"
          />
        </Field>
        <Field label={t('attract.thanks')} htmlFor="attract-thanks">
          <TextInput
            id="attract-thanks"
            value={branding.attract.thanks}
            onChange={(thanks) => setAttract({ thanks: thanks.slice(0, 120) })}
            className="w-72 max-w-full"
          />
        </Field>
        <MediaSlot
          label={t('attract.background')}
          help={t('attract.backgroundHelp')}
          types={['background']}
          asset={view(branding.attract.backgroundAssetId)}
          readOnly={p.readOnly}
          onPick={(a) => {
            remember(a);
            setAttract({ backgroundAssetId: a.id });
          }}
          onRemove={() => setAttract({ backgroundAssetId: null })}
        />
      </Card>

      <Card title={t('fields.title')} subtitle={t('fields.subtitle')}>
        {(['hashtag', 'custom1', 'custom2', 'custom3'] as const).map((k) => (
          <Field key={k} label={t(`fields.${k}`)} help={t('fields.token', { token: `{${k}}` })} htmlFor={`field-${k}`}>
            <TextInput
              id={`field-${k}`}
              value={branding[k]}
              onChange={(v) => setBranding((b) => ({ ...b, [k]: v.slice(0, k === 'hashtag' ? 60 : 200) }))}
              className="w-72 max-w-full"
            />
          </Field>
        ))}
      </Card>

      <Card
        title={t(p.mode === 'photo' ? 'design.layoutTitle' : 'design.overlayTitle')}
        subtitle={t(p.mode === 'photo' ? 'design.layoutSubtitle' : 'design.overlaySubtitle')}
      >
        <DesignCard
          eventId={p.eventId}
          kind={p.mode === 'photo' ? 'layout' : 'overlay'}
          design={p.design}
          library={p.library}
          uploads={p.uploads}
          assets={[...views.values()]}
          theme={theme}
          tokens={tokens}
          printSize={p.photo.printSize}
          shots={p.photo.shots}
          aspect={p.video.aspect}
          readOnly={p.readOnly}
        />
      </Card>

      {p.mode === 'video360' && (
        <>
          <Card title={t('cards.title')} subtitle={t('cards.subtitle')}>
            <MediaSlot
              label={t('cards.intro')}
              help={t('cards.introHelp')}
              types={['intro']}
              icon={Film}
              asset={view(intro)}
              readOnly={p.readOnly}
              onPick={(a) => void setRef('introAssetId', a)}
              onRemove={() => void setRef('introAssetId', null)}
            />
            <MediaSlot
              label={t('cards.outro')}
              help={t('cards.outroHelp')}
              types={['outro']}
              icon={Film}
              asset={view(outro)}
              readOnly={p.readOnly}
              onPick={(a) => void setRef('outroAssetId', a)}
              onRemove={() => void setRef('outroAssetId', null)}
            />
            <Field label={t('cards.length')} help={t('cards.lengthHelp')}>
              <Slider
                value={media.cardSeconds}
                min={1}
                max={5}
                step={0.5}
                unit="s"
                width="w-64 max-w-full"
                label={t('cards.length')}
                onChange={(cardSeconds) => setMedia((m) => ({ ...m, cardSeconds }))}
              />
            </Field>
          </Card>

          <Card title={t('music.title')} subtitle={t('music.subtitle')}>
            <MediaSlot
              label={t('music.track')}
              help={t('music.trackHelp')}
              types={['audio']}
              icon={Music}
              asset={musicView}
              readOnly={p.readOnly}
              onPick={(a) => {
                remember(a);
                setMedia((m) => ({ ...m, music: { ...DEFAULT_MUSIC, assetId: a.id } }));
              }}
              onRemove={() => setMedia((m) => ({ ...m, music: null }))}
            />
            {media.music && (
              <div className="pb-5">
                {song?.id !== media.music.assetId ? (
                  <div role="status" aria-label={t('music.loading')} className="shimmer h-24 rounded-xl" />
                ) : (
                  <AudioEditor
                    source={song.blob}
                    value={media.music}
                    outputSeconds={outputSeconds}
                    disabled={p.readOnly}
                    onChange={(edit: MusicEdit) =>
                      setMedia((m) => (m.music ? { ...m, music: { ...m.music, ...edit } } : m))
                    }
                  />
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </fieldset>
  );
}
