'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Music, Pause, Play } from 'lucide-react';
import { assetMediaKind } from '@immersia/shared';
import { cx } from '@immersia/ui';
import type { AssetView } from '@/server/assets';

/** Play or pause; starting one preview stops any other, so a grid never plays over itself. */
function toggle(media: HTMLMediaElement | null) {
  if (!media) return;
  if (!media.paused) {
    media.pause();
    return;
  }
  for (const other of document.querySelectorAll<HTMLMediaElement>('[data-asset-media]')) {
    if (other !== media) other.pause();
  }
  // Refused when the browser blocks playback or the signed URL has expired: stay paused.
  media.play().catch(() => {});
}

function PlayButton({
  asset,
  playing,
  onClick,
  large,
}: {
  asset: AssetView;
  playing: boolean;
  onClick: () => void;
  large?: boolean;
}) {
  const t = useTranslations('studio.assets');
  const Icon = playing ? Pause : Play;
  return (
    <button
      type="button"
      aria-label={playing ? t('pause', { name: asset.name }) : t('play', { name: asset.name })}
      onClick={onClick}
      className={cx(
        'focus-ring z-10 grid place-items-center rounded-full border border-line-strong bg-elev text-fg shadow-card transition-colors hover:bg-sunken',
        large ? 'relative size-12' : 'absolute bottom-2 left-2 size-9',
      )}
    >
      <Icon className={large ? 'size-5' : 'size-4'} aria-hidden fill="currentColor" />
    </button>
  );
}

function VideoPreview({ asset, controls }: { asset: AssetView; controls: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <video
        ref={video}
        // The fragment makes browsers that don't paint a frame for preload="metadata" show the first one.
        src={`${asset.url}#t=0.1`}
        muted
        playsInline
        loop
        aria-hidden
        preload="metadata"
        data-asset-media=""
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="size-full object-contain"
      />
      {controls && <PlayButton asset={asset} playing={playing} onClick={() => toggle(video.current)} />}
    </>
  );
}

function AudioPreview({ asset, controls }: { asset: AssetView; controls: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <audio
        ref={audio}
        src={asset.url}
        preload="none"
        data-asset-media=""
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      {controls ? (
        <>
          <Music className="absolute top-3 left-3 size-4 text-subtle" aria-hidden />
          <PlayButton asset={asset} playing={playing} onClick={() => toggle(audio.current)} large />
        </>
      ) : (
        <Music className="size-9 text-subtle" aria-hidden />
      )}
    </>
  );
}

/** "Aa Bb 123" set in the uploaded font, loaded straight from storage (needs the bucket's CORS rule). */
function FontSample({ asset }: { asset: AssetView }) {
  const family = `asset-${asset.id}`;
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const face = new FontFace(family, `url("${asset.url}")`);
    face.load().then(
      () => {
        if (cancelled) return;
        document.fonts.add(face);
        setLoadedUrl(asset.url);
      },
      () => {}, // Unreadable or blocked: the sample stays in the page font, dimmed.
    );
    return () => {
      cancelled = true;
      document.fonts.delete(face);
    };
  }, [asset.url, family]);
  const ready = loadedUrl === asset.url;
  return (
    <span
      aria-hidden
      className={cx('text-[28px] leading-none text-fg transition-opacity', ready ? 'opacity-100' : 'opacity-40')}
      style={ready ? { fontFamily: `"${family}"` } : undefined}
    >
      Aa Bb 123
    </span>
  );
}

/**
 * What an asset looks like: the image itself, a video's first frame, a music tile with a play
 * button, or a font specimen. With `controls` off it is inert, for use inside another button.
 */
export function AssetPreview({
  asset,
  controls = true,
  className,
}: {
  asset: AssetView;
  controls?: boolean;
  className?: string;
}) {
  const kind = assetMediaKind(asset.mime);
  return (
    <div className={cx('relative grid aspect-[4/3] place-items-center overflow-hidden bg-sunken', className)}>
      {kind === 'image' && (
        // Presigned bucket URLs: next/image would route every preview through the optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-contain"
        />
      )}
      {kind === 'video' && <VideoPreview asset={asset} controls={controls} />}
      {kind === 'audio' && <AudioPreview asset={asset} controls={controls} />}
      {kind === 'font' && <FontSample asset={asset} />}
    </div>
  );
}
