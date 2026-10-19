import { overlayCanvasFor, type ASPECTS, type TemplateElement } from '@immersia/shared';
import type { Template } from './render';

export type Aspect = (typeof ASPECTS)[number];
export const OVERLAY_STYLES = ['band', 'frame', 'pill', 'blank'] as const;
export type OverlayStyle = (typeof OVERLAY_STYLES)[number];

export interface OverlayOptions {
  /** Event theme (screen 5): the overlay follows the booth's colours and type. */
  background: string;
  ink: string;
  accent: string;
  font: 'sans' | 'serif';
}

/** Fully transparent: the video shows through everywhere the overlay draws nothing. */
export const TRANSPARENT = '#00000000';

const base = { rotation: 0, opacity: 1, locked: false, hidden: false } as const;

/**
 * Starting points for a 360 overlay (VID-4, PHO-6): the event name and date over the video in the
 * event's theme. The operator restyles them in the editor; `blank` is an empty transparent canvas.
 */
export function overlayPreset(aspect: Aspect, style: OverlayStyle, o: OverlayOptions): Template {
  const { width: W, height: H } = overlayCanvasFor(aspect);
  const unit = Math.min(W, H);
  const family = o.font === 'serif' ? 'Instrument Serif' : 'Satoshi';
  const titleWeight = o.font === 'serif' ? 400 : 700;
  const elements: TemplateElement[] = [];
  const text = (
    id: string,
    box: { x: number; y: number; width: number; height: number },
    value: string,
    fontSize: number,
    color: string,
    extra: Partial<Extract<TemplateElement, { type: 'text' }>> = {},
  ): TemplateElement => ({
    ...base,
    ...box,
    id,
    type: 'text',
    text: value,
    fontFamily: family,
    fontWeight: titleWeight,
    fontStyle: 'normal',
    fontSize: Math.round(fontSize),
    lineHeight: 1.1,
    letterSpacing: o.font === 'serif' ? 0 : -Math.round(fontSize * 0.03),
    color,
    align: 'center',
    verticalAlign: 'middle',
    uppercase: false,
    autoFit: true,
    ...extra,
  });
  const dateLine = (id: string, box: { x: number; y: number; width: number; height: number }, color: string) =>
    text(id, box, '%d %B %Y', unit * 0.032, color, {
      fontFamily: 'Satoshi',
      fontWeight: 500,
      letterSpacing: Math.round(unit * 0.032 * 0.12),
      uppercase: true,
    });

  if (style === 'band') {
    const bandH = Math.round(unit * 0.26);
    elements.push({
      ...base,
      id: 'band',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: H - bandH,
      width: W,
      height: bandH,
      fill: `${o.background}e6`,
      stroke: null,
      strokeWidth: 0,
      cornerRadius: 0,
    });
    const pad = Math.round(unit * 0.06);
    elements.push(
      text('title', { x: pad, y: H - bandH + pad * 0.6, width: W - 2 * pad, height: bandH * 0.5 }, '{eventName}', unit * 0.085, o.ink),
      dateLine('date', { x: pad, y: H - bandH * 0.38, width: W - 2 * pad, height: bandH * 0.2 }, o.ink),
    );
  } else if (style === 'frame') {
    const inset = Math.round(unit * 0.035);
    const stroke = Math.round(unit * 0.012);
    elements.push({
      ...base,
      id: 'frame',
      type: 'shape',
      shape: 'rect',
      x: inset,
      y: inset,
      width: W - 2 * inset,
      height: H - 2 * inset,
      fill: TRANSPARENT,
      stroke: o.accent,
      strokeWidth: stroke,
      cornerRadius: Math.round(unit * 0.03),
    });
    const labelH = Math.round(unit * 0.15);
    const labelY = H - inset - labelH - Math.round(unit * 0.04);
    // White type needs its own ground: a bright video would swallow it.
    elements.push({
      ...base,
      id: 'label',
      type: 'shape',
      shape: 'rect',
      x: inset * 2,
      y: labelY - Math.round(unit * 0.015),
      width: W - inset * 4,
      height: labelH + Math.round(unit * 0.03),
      fill: `${o.ink}b3`,
      stroke: null,
      strokeWidth: 0,
      cornerRadius: Math.round(unit * 0.02),
    });
    elements.push(
      text('title', { x: inset * 2, y: labelY, width: W - inset * 4, height: labelH * 0.62 }, '{eventName}', unit * 0.07, '#ffffff'),
      dateLine('date', { x: inset * 2, y: labelY + labelH * 0.66, width: W - inset * 4, height: labelH * 0.3 }, '#ffffff'),
    );
  } else if (style === 'pill') {
    const pillW = Math.round(unit * 0.78);
    const pillH = Math.round(unit * 0.13);
    const x = Math.round((W - pillW) / 2);
    const y = H - pillH - Math.round(unit * 0.08);
    elements.push(
      {
        ...base,
        id: 'pill',
        type: 'shape',
        shape: 'rect',
        x,
        y,
        width: pillW,
        height: pillH,
        fill: o.background,
        stroke: null,
        strokeWidth: 0,
        cornerRadius: Math.round(pillH / 2),
      },
      text('title', { x: x + pillH * 0.45, y, width: pillW - pillH * 0.9, height: pillH }, '{eventName}', unit * 0.06, o.ink),
    );
  }

  return {
    canvas: { width: W, height: H, dpi: 72, printSize: null, background: TRANSPARENT, backgroundAssetId: null },
    elements,
  };
}

/**
 * Fit a document onto a canvas of another size (the event's print size or video aspect changed after
 * the design was made): one uniform scale, centred, so nothing is distorted and text keeps its
 * proportions. Elements stay editable; the operator tidies the margins.
 */
export function fitDocument(t: Template, width: number, height: number): Template {
  const s = Math.min(width / t.canvas.width, height / t.canvas.height);
  const dx = (width - t.canvas.width * s) / 2;
  const dy = (height - t.canvas.height * s) / 2;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    canvas: { ...t.canvas, width, height },
    elements: t.elements.map((el) => {
      const moved = {
        ...el,
        x: r(dx + el.x * s),
        y: r(dy + el.y * s),
        width: Math.max(1, r(el.width * s)),
        height: Math.max(1, r(el.height * s)),
      };
      if (moved.type === 'text')
        return { ...moved, fontSize: Math.max(1, r(moved.fontSize * s)), letterSpacing: r(moved.letterSpacing * s) };
      if (moved.type === 'shape')
        return { ...moved, strokeWidth: r(moved.strokeWidth * s), cornerRadius: r(moved.cornerRadius * s) };
      if (moved.type === 'photo') return { ...moved, cornerRadius: r(moved.cornerRadius * s) };
      return moved;
    }),
  };
}
