'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { MaskThrottle, type LiveBackground } from '@immersia/render-engine/background';
import type { GradePreview } from '@immersia/render-engine/preview';
import { cx } from '@immersia/ui';
import { mountPreview, type MountedPreview } from '@/lib/grade-canvas';
import { pageSegmenter } from '@/lib/segmenter';

/** The preview never needs more than this on its long side; the recording itself is untouched. */
const MAX_PREVIEW = 960;
/** Person segmentation on the preview runs at most this often, and never two at once (CAP-10). */
const SEGMENT_FPS = 15;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/**
 * CAP-9: the event's colour look on the live camera preview, through the same shader that grades
 * the render, so guests see what they'll get. CAP-10: and the event's background behind them, found
 * on the device by the person segmenter (at most 15 times a second; the frames in between reuse the
 * latest, smoothed mask, and capture never waits for it). Drawn over the camera's <video>, frame by
 * frame; with neither set nothing is drawn and the plain video shows.
 *
 * Changing the look or the background reconfigures the running preview. Each camera resolution gets a
 * canvas of its own (a lens or camera switch, or a tablet turned round, changes the video's size),
 * thrown away with its WebGL context when the next one replaces it: a canvas keeps its context for
 * life, so a released one can never draw again.
 */
export function LookPreview({
  video,
  lookId,
  background = null,
  onBackgroundUnavailable,
  className,
}: {
  video: RefObject<HTMLVideoElement | null>;
  lookId: string | null;
  background?: LiveBackground | null;
  /** The segmenter could not start here: the preview shows the real background. */
  onBackgroundUnavailable?: () => void;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const active = Boolean(lookId || background);
  // What to draw, read by the frame loop.
  const latest = useRef({ lookId, background });
  const unavailable = useRef(onBackgroundUnavailable);
  useEffect(() => {
    latest.current = { lookId, background };
    unavailable.current = onBackgroundUnavailable;
  });

  useEffect(() => {
    const v = video.current as VideoWithFrameCallback | null;
    const el = host.current;
    if (!active || !v || !el) return;
    let mounted: MountedPreview | null = null;
    let size = '';
    let applied: typeof latest.current | null = null;
    let handle = 0;
    let stopped = false;
    let segmenter: Awaited<ReturnType<typeof pageSegmenter>> | null = null;
    let segmenterRequested = false;
    const throttle = new MaskThrottle(SEGMENT_FPS);

    const discard = () => {
      mounted?.destroy();
      mounted = null;
    };

    const segment = (p: GradePreview) => {
      const now = performance.now();
      if (!segmenter || !p.needsMask || !throttle.ready(now)) return;
      throttle.begin();
      segmenter.mask(v, now).then(
        (mask) => {
          if (!stopped && mounted?.preview === p) p.setMask(mask);
          throttle.end(performance.now() - now, performance.now());
        },
        () => throttle.fail(performance.now()),
      );
    };

    const frame = () => {
      if (stopped) return;
      const w = v.videoWidth;
      const h = v.videoHeight;
      if (w && h && v.readyState >= 2) {
        const s = Math.min(1, MAX_PREVIEW / Math.max(w, h));
        const key = `${Math.round(w * s)}x${Math.round(h * s)}`;
        if (key !== size) {
          // A new camera or resolution: a canvas and context of the right size (null: no WebGL2, and the
          // plain video stays visible underneath).
          discard();
          size = key;
          mounted = mountPreview(el, Math.round(w * s), Math.round(h * s));
          applied = null;
        }
        const want = latest.current;
        if (mounted && applied !== want) {
          try {
            mounted.preview.configure({
              look: want.lookId ? { id: want.lookId, intensity: 1 } : null,
              effects: [],
              background: want.background,
            });
            applied = want;
          } catch {
            discard(); // a shader this GPU rejects: the plain video stays visible underneath
          }
        }
        // The person finder is started the first time a background is wanted, and only then.
        if (want.background && !segmenterRequested) {
          segmenterRequested = true;
          pageSegmenter().then(
            (seg) => {
              if (!stopped) segmenter = seg;
            },
            (err: unknown) => {
              console.warn('[preview] background replacement unavailable', err);
              if (!stopped) unavailable.current?.();
            },
          );
        }
        if (mounted) {
          try {
            segment(mounted.preview);
            mounted.preview.draw(v);
          } catch {
            discard(); // never retried for this size: a frame that cannot be drawn is left to the plain video
          }
        }
      }
      handle = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(frame) : requestAnimationFrame(frame);
    };
    frame();
    return () => {
      stopped = true;
      if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
      discard();
    };
  }, [video, active]);

  if (!active) return null;
  return <div ref={host} aria-hidden className={cx('pointer-events-none', className)} />;
}
