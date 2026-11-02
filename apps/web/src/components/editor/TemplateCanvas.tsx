'use client';

import { useEffect, useRef } from 'react';
import { renderTemplate, type RenderInputs, type Template } from '@immersia/layout';
import { cx } from '@immersia/ui';

/**
 * A template drawn by the print renderer, scaled to fit `maxWidth` × `maxHeight` CSS pixels (sharp on
 * high-DPI screens). Thumbnails, the design chooser and the full-screen viewer all use this, so every
 * preview is exactly what prints or plays.
 */
export function TemplateCanvas({
  doc,
  inputs,
  redrawKey,
  maxWidth,
  maxHeight,
  label,
  backdrop,
  className,
}: {
  doc: Template;
  inputs: RenderInputs;
  redrawKey?: number;
  maxWidth: number;
  maxHeight: number;
  label: string;
  /** Drawn under the template: overlays are shown over a stand-in for the video. */
  backdrop?: string;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const s = Math.min(maxWidth / doc.canvas.width, maxHeight / doc.canvas.height);
  const cssW = Math.max(1, Math.round(doc.canvas.width * s));
  const cssH = Math.max(1, Math.round(doc.canvas.height * s));
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (backdrop) {
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    renderTemplate(ctx, doc, inputs, (cssW * dpr) / doc.canvas.width);
  }, [doc, inputs, redrawKey, cssW, cssH, backdrop]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      style={{ width: cssW, height: cssH }}
      className={cx('block rounded-md shadow-[0_0_0_1px_rgba(17,17,16,0.08)]', className)}
    />
  );
}
