import { canvasSizeFor } from '@immersia/shared';
import type { Aspect } from '../overlays';
import { MIN_PRINT_QR_PX, type PrintSize } from '../presets';

/**
 * Geometry of the built-in template library (PHO-5). A layout is only positions: photo slots, text
 * zones, the QR plate, decorations and the places ornaments may go. Colours, type and which ornament
 * goes where belong to a style (styles.ts); generate.ts combines the two into a template document.
 * Everything is in canvas pixels (300 DPI for prints, 1080 px on the short side for overlays).
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Align = 'left' | 'center' | 'right';
/** What text sits on, so the style can pick a readable colour: the page itself or an accent block. */
export type Surface = 'bg' | 'accent';

export interface PhotoSlot extends Box {
  shot: number;
  rotation?: number;
  /** Corner radius in px; a circle is half the side. Left out, the style's radius applies. */
  radius?: number;
  /** Sits on its own card, ring or film frame: the style's photo mat does not apply. */
  plain?: boolean;
}

export interface TextZone extends Box {
  align: Align;
  surface: Surface;
}

/**
 * Shapes a layout draws, coloured by role: `panel` (the style's secondary), `paper` (card stock),
 * `shade` (a soft shadow under a card), `film` and `hole` (a film strip), `rule` (a hairline),
 * `cut` (a dashed cut guide), `tint` (the event background, see-through, over video), `band` (an accent
 * block) and `line` (an accent outline).
 */
export type DecoRole = 'panel' | 'paper' | 'shade' | 'film' | 'hole' | 'rule' | 'cut' | 'tint' | 'band' | 'line';

export interface Deco extends Box {
  role: DecoRole;
  shape?: 'rect' | 'ellipse';
  radius?: number;
  rotation?: number;
  /** Outline width for `line`. */
  stroke?: number;
  /** Drawn over the photos instead of under them. */
  front?: boolean;
}

/**
 * Where a style may put an ornament: a small crest above the title, stickers on the photos' top
 * corners, flourishes at the corners of a frame, or one larger feature in a free spot.
 */
export type OrnamentRole = 'crest' | 'sticker' | 'corner' | 'feature';

export interface OrnamentZone extends Box {
  role: OrnamentRole;
  /** Corner flourishes are drawn for the top-left; the zone says how far to turn them. */
  rotation?: number;
}

export interface Geometry {
  photos: PhotoSlot[];
  decos: Deco[];
  title: TextZone;
  subtitle: TextZone | null;
  /** The box title and subtitle sit in; a style may paint it as a panel. */
  textBox: Box | null;
  /** QR plates (the QR and its short code); empty when the layout is QR-free. */
  qrs: Box[];
  ornaments: OrnamentZone[];
  /** Whether the style's page border applies (it would clash with full-bleed and tilted designs). */
  border: boolean;
}

export type Family =
  | 'stack'
  | 'grid'
  | 'hero'
  | 'row'
  | 'single'
  | 'duo'
  | 'polaroid'
  | 'circles'
  | 'film'
  | 'stagger'
  | 'mosaic'
  | 'double'
  | 'frame'
  | 'panel'
  | 'header'
  | 'fullbleed'
  | 'band'
  | 'badge'
  | 'lower-third'
  | 'side';

export interface LibraryLayout {
  /** Stable, `[a-z0-9-]` only: it is part of every template id built on it. */
  id: string;
  kind: 'layout' | 'overlay';
  size: PrintSize | Aspect;
  family: Family;
  /** Distinct shots the layout takes (0 for overlays). */
  shots: number;
  canvas: { width: number; height: number };
  geometry: Geometry;
}

/** Share of a QR element's height the short code takes under the QR (render.ts draws it that way). */
export const CODE_BAND = 0.16;
export const plateHeight = (side: number) => Math.ceil(side / (1 - CODE_BAND));

/** Page numbers of a print size. */
export interface Frame {
  size: PrintSize;
  W: number;
  H: number;
  /** The short side. */
  u: number;
  /** Margin round the content. */
  m: number;
  /** Gap between photos. */
  g: number;
  /** QR width (never below 18 mm plus a little, DL-3). */
  side: number;
  /** QR plate height: the QR plus its short code. */
  plate: number;
}

export function frameOf(size: PrintSize): Frame {
  const { width: W, height: H } = canvasSizeFor(size);
  const u = Math.min(W, H);
  const side = Math.max(MIN_PRINT_QR_PX + 7, Math.round(u * 0.2));
  return {
    size,
    W,
    H,
    u,
    m: Math.max(48, Math.round(u * 0.07)),
    g: Math.round(u * 0.035),
    side,
    plate: plateHeight(side),
  };
}

export const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

export const inset = (b: Box, d: number): Box => box(b.x + d, b.y + d, b.width - 2 * d, b.height - 2 * d);

export const centerOf = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** A `width`×`height` box centred in `within`. */
export const centered = (within: Box, width: number, height: number): Box =>
  box(within.x + (within.width - width) / 2, within.y + (within.height - height) / 2, width, height);

/** Split a box into rows by weight, `gap` apart. */
export function rows(b: Box, weights: readonly number[], gap: number): Box[] {
  const total = weights.reduce((a, w) => a + w, 0);
  const free = b.height - gap * (weights.length - 1);
  let y = b.y;
  return weights.map((w) => {
    const h = (free * w) / total;
    const r = box(b.x, y, b.width, h);
    y += h + gap;
    return r;
  });
}

/** Split a box into columns by weight, `gap` apart. */
export function cols(b: Box, weights: readonly number[], gap: number): Box[] {
  const total = weights.reduce((a, w) => a + w, 0);
  const free = b.width - gap * (weights.length - 1);
  let x = b.x;
  return weights.map((w) => {
    const wd = (free * w) / total;
    const r = box(x, b.y, wd, b.height);
    x += wd + gap;
    return r;
  });
}

/** Equal cells, row by row. */
export function grid(b: Box, nCols: number, nRows: number, gap: number): Box[] {
  return rows(b, Array<number>(nRows).fill(1), gap).flatMap((r) => cols(r, Array<number>(nCols).fill(1), gap));
}

/** The photo slot of `shot` in `b`. */
export const slot = (shot: number, b: Box, extra: Partial<Omit<PhotoSlot, keyof Box | 'shot'>> = {}): PhotoSlot => ({
  ...b,
  shot,
  ...extra,
});

/** Slots for several boxes, shots counting up from `first`. */
export const slots = (boxes: readonly Box[], first = 0): PhotoSlot[] => boxes.map((b, i) => slot(first + i, b));

/** A box turned `deg` degrees about its own centre, as the renderer does. */
export function rotatedCorners(b: Box, deg: number): [number, number][] {
  const c = centerOf(b);
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return (
    [
      [-b.width / 2, -b.height / 2],
      [b.width / 2, -b.height / 2],
      [b.width / 2, b.height / 2],
      [-b.width / 2, b.height / 2],
    ] as const
  ).map(([dx, dy]) => [c.x + dx * cos - dy * sin, c.y + dx * sin + dy * cos] as [number, number]);
}

/**
 * `inner` (in the card's untilted coordinates) placed on the card as it looks after the card is
 * turned `deg` degrees about its centre: same size, moved and turned with it.
 */
export function onCard(card: Box, deg: number, inner: Box): Box & { rotation: number } {
  const c = centerOf(card);
  const i = centerOf(inner);
  const r = (deg * Math.PI) / 180;
  const dx = i.x - c.x;
  const dy = i.y - c.y;
  const nx = c.x + dx * Math.cos(r) - dy * Math.sin(r);
  const ny = c.y + dx * Math.sin(r) + dy * Math.cos(r);
  return { x: nx - inner.width / 2, y: ny - inner.height / 2, width: inner.width, height: inner.height, rotation: deg };
}

/** Keep a box on the page without resizing it. */
export function keepOn<B extends Box>(b: B, W: number, H: number): B {
  return { ...b, x: Math.min(Math.max(0, b.x), W - b.width), y: Math.min(Math.max(0, b.y), H - b.height) };
}

/** Text zones: the title, an optional date line and an optional crest above, in `T`. */
export interface TextBlock {
  title: TextZone;
  subtitle: TextZone | null;
  crest: OrnamentZone | null;
}

export function textBlock(
  u: number,
  T: Box,
  o: { align: Align; crest?: boolean; sub?: boolean; surface?: Surface },
): TextBlock {
  const surface = o.surface ?? 'bg';
  const cs = o.crest ? Math.round(Math.min(T.height * 0.2, u * 0.06)) : 0;
  const gapC = Math.round(cs * 0.3);
  const rest = T.height - (cs ? cs + gapC : 0);
  const subH = o.sub === false ? 0 : Math.round(rest * 0.27);
  const between = subH ? Math.round(rest * 0.05) : 0;
  const titleH = rest - subH - between;
  const top = T.y + (cs ? cs + gapC : 0);
  const crestX = o.align === 'left' ? T.x : o.align === 'right' ? T.x + T.width - cs : T.x + (T.width - cs) / 2;
  return {
    title: { ...box(T.x, top, T.width, titleH), align: o.align, surface },
    subtitle: subH ? { ...box(T.x, top + titleH + between, T.width, subH), align: o.align, surface } : null,
    crest: cs ? { role: 'crest', ...box(crestX, T.y, cs, cs) } : null,
  };
}

/** What a bottom block places beside the QR: text to its left or right, or stacked above it. */
export type FooterMode = 'right' | 'left' | 'stack' | 'center';

export interface Footer extends TextBlock {
  /** Free space above the footer, for the photos. */
  area: Box;
  qr: Box | null;
  textBox: Box;
  rule: Deco;
}

/**
 * The footer every print starts from: title and date with the guest QR (DL-3), `height` px tall at the
 * bottom of the page. `center` has no QR (the 9:16 story is for screens).
 */
export function bottomBlock(P: Frame, o: { mode: FooterMode; height: number; crest?: boolean; sub?: boolean }): Footer {
  const F = box(P.m, P.H - P.m - o.height, P.W - 2 * P.m, o.height);
  const area = box(P.m, P.m, F.width, F.y - P.g - P.m);
  const rule: Deco = { role: 'rule', ...box(P.m, F.y - Math.round(P.g / 2) - 1, F.width, 2) };
  let T: Box;
  let qr: Box | null = null;
  let align: Align = 'left';
  switch (o.mode) {
    case 'right':
      qr = box(F.x + F.width - P.side, F.y + (F.height - P.plate) / 2, P.side, P.plate);
      T = box(F.x, F.y, F.width - P.side - P.g, F.height);
      break;
    case 'left':
      qr = box(F.x, F.y + (F.height - P.plate) / 2, P.side, P.plate);
      T = box(F.x + P.side + P.g, F.y, F.width - P.side - P.g, F.height);
      break;
    case 'stack':
      qr = box(F.x + (F.width - P.side) / 2, F.y + F.height - P.plate, P.side, P.plate);
      T = box(F.x, F.y, F.width, F.height - P.plate - P.g);
      align = 'center';
      break;
    case 'center':
      T = F;
      align = 'center';
      break;
  }
  if (qr && F.height < P.plate) throw new Error(`footer of ${o.height}px cannot hold a ${P.plate}px QR`);
  return { ...textBlock(P.u, T, { align, crest: o.crest, sub: o.sub }), area, qr, textBox: T, rule };
}

/** A title on top of the page and a footer row with the date and the QR. */
export function headerBlock(
  P: Frame,
  o: { headerHeight: number; qr: boolean; crest?: boolean },
): {
  area: Box;
  title: TextZone;
  subtitle: TextZone;
  crest: OrnamentZone | null;
  qr: Box | null;
  textBox: Box;
  rules: Deco[];
} {
  const head = box(P.m, P.m, P.W - 2 * P.m, o.headerHeight);
  const top = textBlock(P.u, head, { align: 'center', crest: o.crest, sub: false });
  const footH = o.qr ? P.plate : Math.round(P.u * 0.14);
  const foot = box(P.m, P.H - P.m - footH, P.W - 2 * P.m, footH);
  const qr = o.qr ? box(foot.x + foot.width - P.side, foot.y, P.side, P.plate) : null;
  const dateBox = o.qr ? box(foot.x, foot.y, foot.width - P.side - P.g, foot.height) : foot;
  return {
    area: box(P.m, head.y + head.height + P.g, head.width, foot.y - P.g - (head.y + head.height + P.g)),
    title: top.title,
    subtitle: { ...dateBox, align: o.qr ? 'left' : 'center', surface: 'bg' },
    crest: top.crest,
    qr,
    textBox: head,
    rules: [box(head.x, head.y + head.height + Math.round(P.g / 2) - 1, head.width, 2)].map((b) => ({
      ...b,
      role: 'rule' as const,
    })),
  };
}

/**
 * Sticker spots: the two top corners of the photo area, drawn over the photos' corners (confetti,
 * hearts and bats stuck on). They reach a little into the margin and the gap above, never into text.
 */
export function stickersFor(P: { u: number; W: number; H: number; g: number }, A: Box): OrnamentZone[] {
  const s = Math.round(P.u * 0.12);
  const y = A.y - Math.round(P.g * 0.4);
  const out = Math.round(s * 0.3);
  const sticker = (x: number): OrnamentZone => ({ role: 'sticker', ...keepOn(box(x, y, s, s), P.W, P.H) });
  return [sticker(A.x - out), sticker(A.x + A.width - s + out)];
}

/** Whole pixels everywhere (tilts to a tenth of a degree), so every build prints identically. */
export function snap(g: Geometry): Geometry {
  const r = (b: Box) => ({
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.max(1, Math.round(b.width)),
    height: Math.max(1, Math.round(b.height)),
  });
  const turn = (deg: number | undefined) => (deg ? { rotation: Math.round(deg * 10) / 10 } : {});
  return {
    ...g,
    photos: g.photos.map(({ rotation, ...p }) => ({
      ...p,
      ...r(p),
      ...turn(rotation),
      ...(p.radius === undefined ? {} : { radius: Math.round(p.radius) }),
    })),
    decos: g.decos.map(({ rotation, ...d }) => ({
      ...d,
      ...r(d),
      ...turn(rotation),
      ...(d.radius === undefined ? {} : { radius: Math.round(d.radius) }),
      ...(d.stroke === undefined ? {} : { stroke: Math.max(1, Math.round(d.stroke)) }),
    })),
    title: { ...g.title, ...r(g.title) },
    subtitle: g.subtitle && { ...g.subtitle, ...r(g.subtitle) },
    textBox: g.textBox && r(g.textBox),
    qrs: g.qrs.map(r),
    ornaments: g.ornaments.map(({ rotation, ...o }) => ({ ...o, ...r(o), ...turn(rotation) })),
  };
}
