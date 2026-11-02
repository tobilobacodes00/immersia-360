'use client';

/* eslint-disable @next/next/no-img-element -- media comes from signed storage links or the device's own
   cache as object URLs: nothing for the image optimiser to do. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { DisplayItem } from '@immersia/shared';
import { cx } from '@immersia/ui';
import { useDisplay } from './context';
import { columnCenter, columnItems, fillFor } from './playback';
import { useMediaSrc } from './use-media';
import { useElementSize } from './use-tv';

/** The cross-fade between items; instant cuts when the viewer asks for reduced motion. */
const FADE_S = 0.7;

/** A video's own length must reach this close to the dwell before it stops looping on screen. */
const LOOP_SLACK_MS = 300;

/**
 * One file on screen, played from the device's copy when it has one (LIV-12). The `main` item is the
 * one the dwell clock follows: it reports its length and any failure, and carries the sound.
 */
export function PlayedMedia({
  item,
  fit,
  main = false,
  playId = 0,
  playing = true,
  className,
}: {
  item: DisplayItem;
  fit: 'cover' | 'contain';
  main?: boolean;
  playId?: number;
  /** False shows a still frame (Ticker thumbnails). */
  playing?: boolean;
  className?: string;
}) {
  const { config, durationMs, unlocked, reportLength, fail, reportSoundBlocked } = useDisplay();
  const src = useMediaSrc(item.media.url);
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [ownSeconds, setOwnSeconds] = useState<number | null>(null);
  const wantSound = main && !config.settings.videosMuted;

  useEffect(() => {
    const el = video.current;
    if (!el || !src || !playing) return;
    el.muted = !wantSound;
    el.play().catch(() => {
      if (!wantSound) return;
      // The browser refuses sound until a key press or click: play silently, and say so.
      el.muted = true;
      el.play().catch(() => undefined);
      reportSoundBlocked();
    });
    // `unlocked` is a dependency on purpose: once a gesture has happened, try sound again.
  }, [src, playing, wantSound, unlocked, reportSoundBlocked]);

  if (!src) return null;

  const classes = cx(
    'absolute inset-0 size-full transition-opacity duration-500',
    fit === 'cover' ? 'object-cover' : 'object-contain',
    ready ? 'opacity-100' : 'opacity-0',
    className,
  );
  const failed = () => {
    if (main) fail(item.id);
  };

  if (item.media.type !== 'video')
    return <img src={src} alt="" decoding="async" className={classes} onLoad={() => setReady(true)} onError={failed} />;

  // Shorter than its dwell: loop until the clock moves on. As long as the dwell, or longer: play through once.
  const loop = !main || ownSeconds === null || ownSeconds * 1000 < durationMs - LOOP_SLACK_MS;
  return (
    <video
      ref={video}
      // A still frame for thumbnails: the browser seeks just past the start.
      src={playing ? src : `${src}#t=0.1`}
      className={classes}
      muted={!wantSound}
      loop={loop}
      autoPlay={playing}
      playsInline
      preload={playing ? 'auto' : 'metadata'}
      disablePictureInPicture
      disableRemotePlayback
      tabIndex={-1}
      aria-hidden
      onLoadedMetadata={(e) => {
        const seconds = e.currentTarget.duration;
        if (Number.isFinite(seconds)) {
          setOwnSeconds(seconds);
          if (main) reportLength(playId, seconds);
        }
        if (!playing) setReady(true);
      }}
      onLoadedData={() => setReady(true)}
      onError={failed}
    />
  );
}

/** LIV-6: the media itself, small, blurred and darkened, behind the same media centred at full height. */
function Backdrop({ item }: { item: DisplayItem }) {
  const src = useMediaSrc(item.media.url);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    video.current?.play().catch(() => undefined);
  }, [src]);
  if (!src) return null;
  // Blurred at an eighth of the size and scaled up: the same look for a fraction of the GPU work.
  const classes =
    'absolute top-0 left-0 h-[12.5%] w-[12.5%] origin-top-left scale-[8] object-cover blur-[5px] brightness-[0.45] will-change-transform';
  return item.media.type === 'video' ? (
    <video ref={video} src={src} className={classes} muted loop autoPlay playsInline aria-hidden tabIndex={-1} />
  ) : (
    <img src={src} alt="" aria-hidden className={classes} />
  );
}

/** The item on screen, filling its stage by LIV-6: cover, a blurred backdrop, or neighbouring columns. */
function Layer({ item, playId, stage }: { item: DisplayItem; playId: number; stage: { w: number; h: number } }) {
  const { config, items } = useDisplay();
  const fill = fillFor(item.media, stage, config.settings.verticalFill);

  if (fill.kind === 'columns') {
    const centre = columnCenter(fill.count);
    return (
      <div className="absolute inset-0 flex gap-[0.2rem] bg-g-ink">
        {columnItems(items, item.id, fill.count).map((cell, i) => (
          <div key={i} className="relative min-w-0 flex-1 overflow-hidden">
            <PlayedMedia item={i === centre ? item : cell} fit="cover" main={i === centre} playId={playId} />
          </div>
        ))}
      </div>
    );
  }
  if (fill.kind === 'blur')
    return (
      <>
        <Backdrop item={item} />
        <PlayedMedia item={item} fit="contain" main playId={playId} />
      </>
    );
  return <PlayedMedia item={item} fit="cover" main playId={playId} />;
}

/** The area an item plays in: measures itself, cross-fades from one item to the next. */
export function Stage({
  item,
  playId,
  badge,
  className,
}: {
  item: DisplayItem | null;
  playId: number;
  badge?: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [measure, size] = useElementSize<HTMLDivElement>();
  const fade = reduced ? 0 : FADE_S;
  return (
    <div ref={measure} className={cx('relative isolate overflow-hidden rounded-[1.5rem] bg-g-ink', className)}>
      <AnimatePresence initial={false}>
        {item && (
          <motion.div
            key={`${item.id}:${playId}`}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            // The old item stays solid underneath until the new one has faded in over it.
            exit={{ opacity: 0, transition: { delay: fade, duration: 0 } }}
            transition={{ duration: fade, ease: 'easeOut' }}
          >
            <Layer item={item} playId={playId} stage={size} />
          </motion.div>
        )}
      </AnimatePresence>
      {badge}
    </div>
  );
}
