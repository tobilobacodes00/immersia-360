'use client';

/**
 * VID-6 audio editor: trim, start offset, fades and volume for an event's music. Controlled: pass the
 * song as a stable `Blob` (hold it in state; a new Blob re-decodes) and the settings as `value`.
 * Preview and render share `gainEnvelope` and the `mixSoundtrack` schedule from the render engine, so
 * the strip, the playhead and the sound you hear are exactly what the booth renders. Stored settings
 * that don't fit the song or the video (a trim past the end of a shorter song, an offset past a
 * shortened spin) are reported once through `onChange` as the nearest valid values.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Music, Play, Square } from 'lucide-react';
import { gainEnvelope } from '@immersia/render-engine/audio';
import { Button, Field, Slider, cx } from '@immersia/ui';
import { decodeSong, type DecodedSong } from './decode';
import { useMixPreview } from './mix-preview';
import { OutputStrip } from './OutputStrip';
import { TrimWaveform } from './TrimWaveform';
import { clampTrim, fitMusic, sameMusic, trimEndOrNull, type MusicEdit } from './peaks';

export type { MusicEdit };

export interface AudioEditorProps {
  /** The song (MP3, M4A/AAC or WAV), or null while the event has none. */
  source: Blob | null;
  value: MusicEdit;
  onChange: (v: MusicEdit) => void;
  /** Length of the rendered video in seconds: the timeline the offset and the fades are placed on. */
  outputSeconds: number;
  disabled?: boolean;
  className?: string;
}

/** A decoded song, or null when decoding failed, for one specific source. */
interface Loaded {
  source: Blob;
  song: DecodedSong | null;
}

/** Always the latest props inside effects that must not re-run when they change. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function AudioEditor({ source, value, onChange, outputSeconds, disabled = false, className }: AudioEditorProps) {
  const t = useTranslations('studio.audioEditor');
  const id = useId();
  const playheadRef = useRef<HTMLDivElement>(null);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // A different source drops the previous song at once, so its decoded audio can be collected.
  if (loaded && loaded.source !== source) setLoaded(null);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    decodeSong(source).then(
      (song) => {
        if (!cancelled) setLoaded({ source, song });
      },
      () => {
        if (!cancelled) setLoaded({ source, song: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source]);

  const current = loaded && loaded.source === source ? loaded : null;
  const song = current?.song ?? null;

  const videoS = Number.isFinite(outputSeconds) && outputSeconds > 0 ? outputSeconds : 1;
  const fitted = song ? fitMusic(value, song.durationMs, Math.round(videoS * 1000)) : value;
  const envelope = song ? gainEnvelope(fitted, song.durationS, videoS) : [];

  const preview = useMixPreview({
    buffer: song?.buffer ?? null,
    music: fitted,
    outputSeconds: videoS,
    disabled,
    playheadRef,
  });

  const latest = useLatest({ fitted, onChange });
  const needsFit = song !== null && !sameMusic(fitted, value);
  useEffect(() => {
    if (needsFit && !disabled) latest.current.onChange(latest.current.fitted);
  }, [needsFit, disabled, latest]);

  if (!source) {
    return (
      <div
        className={cx(
          'flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted',
          className,
        )}
      >
        <Music className="size-5 text-faint" aria-hidden />
        {t('empty')}
      </div>
    );
  }

  if (!current) {
    return (
      <div role="status" className={cx('rounded-xl border border-line bg-elev p-4', className)}>
        <div aria-hidden className="shimmer h-24 rounded-lg" />
        <p className="mt-3 text-[13px] text-muted">{t('loading')}</p>
      </div>
    );
  }

  if (!song) {
    return (
      <div
        role="alert"
        className={cx(
          'flex items-start gap-2 rounded-xl border border-bad/25 bg-bad/[0.05] px-4 py-3 text-[13px] text-bad',
          className,
        )}
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('decodeError')}
      </div>
    );
  }

  const trimEnd = fitted.trimEndMs ?? song.durationMs;

  const onTrim = (handle: 'start' | 'end', ms: number) => {
    if (disabled) return;
    const range = { startMs: fitted.trimStartMs, endMs: trimEnd };
    const moved = handle === 'start' ? { ...range, startMs: ms } : { ...range, endMs: ms };
    const next = clampTrim(moved, handle, song.durationMs);
    if (next.startMs === range.startMs && next.endMs === range.endMs) return;
    onChange({ ...fitted, trimStartMs: next.startMs, trimEndMs: trimEndOrNull(next.endMs, song.durationMs) });
  };
  const patch = (p: Partial<MusicEdit>) => {
    if (!disabled) onChange({ ...fitted, ...p });
  };

  const clipped = fitted.offsetMs / 1000 + (trimEnd - fitted.trimStartMs) / 1000 > videoS + 0.001;

  return (
    <div className={cx('space-y-5', className)}>
      <div role="group" aria-labelledby={`${id}-song`} className="rounded-xl border border-line bg-elev p-4">
        <div id={`${id}-song`} className="text-sm font-medium text-fg">
          {t('song')}
        </div>
        <p className="mt-1 mb-3 text-[13px] leading-relaxed text-faint">{t('songHelp')}</p>
        <TrimWaveform
          peaks={song.peaks}
          durationMs={song.durationMs}
          startMs={fitted.trimStartMs}
          endMs={trimEnd}
          disabled={disabled}
          onTrim={onTrim}
        />
      </div>

      <div role="group" aria-labelledby={`${id}-video`} className="rounded-xl border border-line bg-elev p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div id={`${id}-video`} className="text-sm font-medium text-fg">
              {t('inVideo')}
            </div>
            <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-faint">{t('inVideoHelp')}</p>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={
              preview.playing ? (
                <Square className="size-3.5 fill-current" aria-hidden />
              ) : (
                <Play className="size-3.5 fill-current" aria-hidden />
              )
            }
            onClick={preview.toggle}
            // Stays enabled while playing, so the preview can always be stopped.
            disabled={disabled || (!preview.playing && envelope.length === 0)}
          >
            {preview.playing ? t('stop') : t('play')}
          </Button>
        </div>
        <OutputStrip
          envelope={envelope}
          outputSeconds={videoS}
          volume={fitted.volume}
          clipped={clipped}
          playing={preview.playing}
          playheadRef={playheadRef}
        />
      </div>

      {/* A disabled fieldset disables the kit's sliders and number boxes, which have no disabled prop. */}
      <fieldset disabled={disabled} className="min-w-0 divide-y divide-line disabled:opacity-60">
        <Field label={t('offset')} help={t('offsetHelp')}>
          <Slider
            label={t('offset')}
            value={fitted.offsetMs / 1000}
            min={0}
            max={videoS}
            step={0.1}
            unit="s"
            width="w-72 max-w-full"
            onChange={(s) => patch({ offsetMs: Math.round(s * 1000) })}
          />
        </Field>
        <Field label={t('fadeIn')} help={t('fadeInHelp')}>
          <Slider
            label={t('fadeIn')}
            value={fitted.fadeInMs / 1000}
            min={0}
            max={10}
            step={0.1}
            unit="s"
            width="w-72 max-w-full"
            onChange={(s) => patch({ fadeInMs: Math.round(s * 1000) })}
          />
        </Field>
        <Field label={t('fadeOut')} help={t('fadeOutHelp')}>
          <Slider
            label={t('fadeOut')}
            value={fitted.fadeOutMs / 1000}
            min={0}
            max={10}
            step={0.1}
            unit="s"
            width="w-72 max-w-full"
            onChange={(s) => patch({ fadeOutMs: Math.round(s * 1000) })}
          />
        </Field>
        <Field label={t('volume')}>
          <Slider
            label={t('volume')}
            value={Math.round(fitted.volume * 100)}
            min={0}
            max={100}
            step={1}
            unit="%"
            width="w-72 max-w-full"
            onChange={(percent) => patch({ volume: percent / 100 })}
          />
        </Field>
      </fieldset>
    </div>
  );
}
