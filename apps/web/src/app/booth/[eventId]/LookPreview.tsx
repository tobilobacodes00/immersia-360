'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { cx } from '@immersia/ui';
import { mountPreview, type MountedPreview } from '@/lib/grade-canvas';

/** The preview never needs more than this on its long side; the recording itself is untouched. */
const MAX_PREVIEW = 960;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/**
 * CAP-9: the event's colour look on the live camera preview, through the same shader that grades
 * the render, so guests see what they'll get. Drawn over the camera's <video>, frame by frame; with
 * no look nothing is drawn and the plain video shows.
 *
 * Each camera resolution gets a canvas of its own (a lens or camera switch, or a tablet turned round,
 * changes the video's size), thrown away with its WebGL context when the next one replaces it.
 */
export function LookPreview({
  video,
  lookId,
  className,
}: {
  video: RefObject<HTMLVideoElement | null>;
  lookId: string | null;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = video.current as VideoWithFrameCallback | null;
    const el = host.current;
    if (!lookId || !v || !el) return;
    let mounted: MountedPreview | null = null;
    let size = '';
    let handle = 0;
    let stopped = false;

    const discard = () => {
      mounted?.destroy();
      mounted = null;
    };

    const frame = () => {
      if (stopped) return;
      const w = v.videoWidth;
      const h = v.videoHeight;
      if (w && h && v.readyState >= 2) {
        const s = Math.min(1, MAX_PREVIEW / Math.max(w, h));
        const key = `${Math.round(w * s)}x${Math.round(h * s)}`;
        if (key !== size) {
          // A new camera or resolution: a canvas and context of the right size.
          discard();
          size = key;
          const next = mountPreview(el, Math.round(w * s), Math.round(h * s));
          try {
            next?.preview.configure({ look: { id: lookId, intensity: 1 }, effects: [] });
            mounted = next;
          } catch {
            next?.destroy(); // a shader this GPU rejects: the plain video stays visible underneath
          }
        }
        try {
          mounted?.preview.draw(v);
        } catch {
          discard(); // never retried for this size: a frame that cannot be drawn is left to the plain video
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
  }, [video, lookId]);

  if (!lookId) return null;
  return <div ref={host} aria-hidden className={cx('pointer-events-none', className)} />;
}
