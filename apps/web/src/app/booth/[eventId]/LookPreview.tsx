'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { GradePreview } from '@immersia/render-engine/preview';
import { cx } from '@immersia/ui';

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
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const v = video.current as VideoWithFrameCallback | null;
    const c = canvas.current;
    if (!lookId || !v || !c) return;
    let preview: GradePreview | null = null;
    let size = '';
    let handle = 0;
    let stopped = false;

    const frame = () => {
      if (stopped) return;
      const w = v.videoWidth;
      const h = v.videoHeight;
      if (w && h && v.readyState >= 2) {
        const s = Math.min(1, MAX_PREVIEW / Math.max(w, h));
        const key = `${Math.round(w * s)}x${Math.round(h * s)}`;
        if (key !== size) {
          // A new camera or resolution: a context of the right size.
          preview?.dispose();
          try {
            preview = new GradePreview(c, Math.round(w * s), Math.round(h * s));
            preview.configure({ look: { id: lookId, intensity: 1 }, effects: [] });
          } catch {
            preview = null; // no WebGL2: the plain video stays visible underneath
          }
          size = key;
        }
        preview?.draw(v);
      }
      handle = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(frame) : requestAnimationFrame(frame);
    };
    frame();
    return () => {
      stopped = true;
      if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
      preview?.dispose();
    };
  }, [video, lookId]);

  if (!lookId) return null;
  return <canvas ref={canvas} aria-hidden className={cx('pointer-events-none', className)} />;
}
