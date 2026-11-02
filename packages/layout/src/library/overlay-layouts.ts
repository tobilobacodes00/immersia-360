import { overlayCanvasFor } from '@immersia/shared';
import type { Aspect } from '../overlays';
import {
  box,
  inset,
  snap,
  textBlock,
  type Box,
  type Deco,
  type Family,
  type Geometry,
  type OrnamentZone,
} from './geometry';

/**
 * The video overlay layouts of the library (PHO-5, VID-4): name bands, a framed label, a corner
 * badge, a lower third and a side panel, for 9:16, 1:1 and 16:9. They draw only where something sits
 * on the video (a see-through panel, a frame, a badge) and leave the rest of the canvas clear.
 */

export interface OverlayDef {
  id: string;
  aspect: Aspect;
  family: Family;
  build: (O: OverlayFrame) => Geometry;
}

export interface OverlayFrame {
  aspect: Aspect;
  W: number;
  H: number;
  /** The short side: 1080. */
  u: number;
  pad: number;
}

function frameOf(aspect: Aspect): OverlayFrame {
  const { width: W, height: H } = overlayCanvasFor(aspect);
  const u = Math.min(W, H);
  return { aspect, W, H, u, pad: Math.round(u * 0.05) };
}

const stickerSize = (O: OverlayFrame) => Math.round(O.u * 0.14);

/** Stickers in two corners of the canvas. */
function cornerStickers(O: OverlayFrame, where: 'top' | 'bottom' | 'left'): OrnamentZone[] {
  const s = stickerSize(O);
  const { pad, W, H } = O;
  if (where === 'top')
    return [
      { role: 'sticker', ...box(pad, pad, s, s) },
      { role: 'sticker', ...box(W - pad - s, pad, s, s) },
    ];
  if (where === 'bottom')
    return [
      { role: 'sticker', ...box(pad, H - pad - s, s, s) },
      { role: 'sticker', ...box(W - pad - s, H - pad - s, s, s) },
    ];
  return [
    { role: 'sticker', ...box(pad, pad, s, s) },
    { role: 'sticker', ...box(pad, H - pad - s, s, s) },
  ];
}

interface Parts {
  decos: Deco[];
  text: Box;
  align?: 'left' | 'center';
  crest?: boolean;
  sub?: boolean;
  ornaments: OrnamentZone[];
  /** The box a style may paint as a panel (none: the layout draws its own ground). */
  textBox?: Box | null;
}

function overlay(O: OverlayFrame, p: Parts): Geometry {
  const tb = textBlock(O.u, p.text, { align: p.align ?? 'center', crest: p.crest ?? true, sub: p.sub });
  return snap({
    photos: [],
    decos: p.decos,
    title: tb.title,
    subtitle: tb.subtitle,
    textBox: p.textBox ?? null,
    qrs: [],
    ornaments: [...(tb.crest ? [tb.crest] : []), ...p.ornaments],
    border: false,
  });
}

const DEFS: OverlayDef[] = [];
const def = (aspect: Aspect, name: string, family: Family, build: (O: OverlayFrame) => Geometry) =>
  DEFS.push({ id: `ov-${aspect.replace(':', 'x')}-${name}`, aspect, family, build });

function bandBottom(O: OverlayFrame): Geometry {
  const bh = Math.round(O.u * (O.aspect === '16:9' ? 0.25 : 0.26));
  const panel = box(0, O.H - bh, O.W, bh);
  return overlay(O, {
    decos: [{ role: 'tint', ...panel }],
    text: box(O.pad * 1.5, panel.y + O.pad * 0.5, O.W - O.pad * 3, bh - O.pad),
    ornaments: cornerStickers(O, 'top'),
  });
}

function bandTop(O: OverlayFrame): Geometry {
  const bh = Math.round(O.u * 0.26);
  const panel = box(0, 0, O.W, bh);
  return overlay(O, {
    decos: [{ role: 'tint', ...panel }],
    text: box(O.pad * 1.5, O.pad * 0.5, O.W - O.pad * 3, bh - O.pad),
    ornaments: cornerStickers(O, 'bottom'),
  });
}

function framed(O: OverlayFrame): Geometry {
  const b = Math.round(O.u * 0.035);
  const stroke = Math.round(O.u * 0.012);
  const cs = Math.round(O.u * 0.12);
  const lw = O.aspect === '16:9' ? Math.round(O.u * 0.9) : Math.round(O.W * 0.56);
  const lh = Math.round(O.u * 0.22);
  const label = box((O.W - lw) / 2, O.H - b - stroke - Math.round(O.u * 0.03) - lh, lw, lh);
  const at = b + stroke;
  return overlay(O, {
    decos: [
      { role: 'line', ...box(b, b, O.W - 2 * b, O.H - 2 * b), radius: Math.round(O.u * 0.03), stroke },
      { role: 'tint', ...label, radius: Math.round(O.u * 0.025) },
    ],
    text: inset(label, Math.round(O.u * 0.02)),
    ornaments: [
      { role: 'corner', ...box(at, at, cs, cs), rotation: 0 },
      { role: 'corner', ...box(O.W - at - cs, at, cs, cs), rotation: 90 },
      { role: 'corner', ...box(O.W - at - cs, O.H - at - cs, cs, cs), rotation: 180 },
      { role: 'corner', ...box(at, O.H - at - cs, cs, cs), rotation: 270 },
    ],
  });
}

function badge(O: OverlayFrame): Geometry {
  const bd = Math.round(O.u * (O.aspect === '16:9' ? 0.32 : 0.3));
  const disc = box(O.pad, O.H - O.pad - bd, bd, bd);
  const ph = Math.round(bd * 0.44);
  const pillX = O.pad + Math.round(bd * 0.5);
  const pillW = O.aspect === '16:9' ? Math.round(O.W * 0.4) : O.W - O.pad - pillX;
  const pill = box(pillX, O.H - O.pad - Math.round(bd * 0.72), pillW, ph);
  const titleX = disc.x + bd + Math.round(O.u * 0.02);
  const inner = inset(disc, Math.round(bd * 0.14));
  const g = overlay(O, {
    decos: [
      { role: 'tint', ...pill, radius: ph / 2 },
      { role: 'band', shape: 'ellipse', ...disc },
    ],
    text: box(titleX, pill.y, pill.x + pill.width - titleX - O.pad * 0.6, ph),
    align: 'left',
    crest: false,
    sub: false,
    ornaments: cornerStickers(O, 'top'),
  });
  // The date goes inside the badge, on the accent.
  const date = box(inner.x, inner.y + inner.height * 0.35, inner.width, inner.height * 0.3);
  return snap({ ...g, subtitle: { ...date, align: 'center', surface: 'accent' } });
}

function lowerThird(O: OverlayFrame): Geometry {
  const cw = O.aspect === '16:9' ? Math.round(O.W * 0.46) : O.W - 2 * O.pad;
  const ch = Math.round(O.u * 0.24);
  const y = O.H - O.pad - ch - (O.aspect === '9:16' ? Math.round(O.H * 0.06) : 0);
  const cardBox = box(O.pad, y, cw, ch);
  const bar = Math.round(O.u * 0.016);
  const s = Math.round(O.u * 0.16);
  return overlay(O, {
    decos: [
      { role: 'tint', ...cardBox, radius: Math.round(O.u * 0.03) },
      { role: 'band', ...box(cardBox.x + O.pad * 0.5, cardBox.y + ch * 0.18, bar, ch * 0.64), radius: bar / 2 },
    ],
    text: box(cardBox.x + O.pad * 0.5 + bar + O.pad * 0.5, y + O.pad * 0.4, cw - bar - O.pad * 1.7, ch - O.pad * 0.8),
    align: 'left',
    crest: false,
    ornaments: [
      { role: 'feature', ...box(cardBox.x + cw - s, y - s - Math.round(O.pad * 0.3), s, s) },
      ...cornerStickers(O, 'top'),
    ],
  });
}

function sidePanel(O: OverlayFrame): Geometry {
  const pw = Math.round(O.W * 0.26);
  const panel = box(O.W - pw, 0, pw, O.H);
  const th = Math.round(O.u * 0.6);
  return overlay(O, {
    decos: [{ role: 'tint', ...panel }],
    text: box(panel.x + O.pad, (O.H - th) / 2, pw - 2 * O.pad, th),
    ornaments: cornerStickers(O, 'left'),
  });
}

for (const aspect of ['9:16', '1:1'] as const) {
  def(aspect, 'band-bottom', 'band', bandBottom);
  def(aspect, 'band-top', 'band', bandTop);
  def(aspect, 'frame', 'frame', framed);
  def(aspect, 'badge', 'badge', badge);
  def(aspect, 'lower-third', 'lower-third', lowerThird);
}
def('16:9', 'band-bottom', 'band', bandBottom);
def('16:9', 'side-panel', 'side', sidePanel);
def('16:9', 'frame', 'frame', framed);
def('16:9', 'badge', 'badge', badge);
def('16:9', 'lower-third', 'lower-third', lowerThird);

export const OVERLAY_LAYOUT_DEFS: readonly OverlayDef[] = DEFS;
export { frameOf as overlayFrameOf };
