import {
  ASPECTS,
  PRINT_SIZES,
  onAccent,
  relativeLuminance,
  type TemplateDocument,
  type TemplateElement,
} from '@immersia/shared';
import { TRANSPARENT, type Aspect } from '../overlays';
import type { PrintSize } from '../presets';
import type { Box, Deco, LibraryLayout, OrnamentZone, PhotoSlot, TextZone } from './geometry';
import { layoutsForSize } from './layouts';
import {
  LIBRARY_STYLES,
  type ColorRole,
  type FontSpec,
  type LibraryStyle,
  type StyleId,
  type TemplateCategory,
} from './styles';

/**
 * The built-in template library (PHO-5): every style on a layout for each print size, plus two video
 * overlays, as ready-to-use template documents. Deterministic (no randomness, no clock), built once,
 * and frozen: a template is the same in every build, on the server and in the browser, and cannot be
 * changed by whoever holds a reference to it.
 */

type Shape = Extract<TemplateElement, { type: 'shape' }>;

interface BuiltinBase {
  /** `lib:<category>:<style>:<layout>`. Never a database id. */
  id: `lib:${string}`;
  category: TemplateCategory;
  style: StyleId;
  layoutId: string;
  /** Distinct shots the template takes (0 for overlays). */
  shots: number;
  doc: TemplateDocument;
}

export type BuiltinTemplate =
  | (BuiltinBase & { kind: 'layout'; printSize: PrintSize; aspect?: undefined })
  | (BuiltinBase & { kind: 'overlay'; aspect: Aspect; printSize?: undefined });

export const BUILTIN_PREFIX = 'lib:';
export const isBuiltinId = (id: string) => id.startsWith(BUILTIN_PREFIX);

const base = { rotation: 0, opacity: 1, locked: false, hidden: false } as const;

/** `#rrggbb` + alpha (0–1) as `#rrggbbaa`. */
const withAlpha = (hex: string, a: number) =>
  `${hex}${Math.round(Math.min(1, Math.max(0, a)) * 255)
    .toString(16)
    .padStart(2, '0')}`;

/** Blend two `#rrggbb` colours: `t` = 0 is `a`, 1 is `b`. */
function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(ch(a, i) * (1 - t) + ch(b, i) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 &&
  inner.y + inner.height <= outer.y + outer.height + 1;

const shrink = (z: Box, scale: number): Box => ({
  x: z.x + (z.width * (1 - scale)) / 2,
  y: z.y + (z.height * (1 - scale)) / 2,
  width: z.width * scale,
  height: z.height * scale,
});

function build(style: LibraryStyle, layout: LibraryLayout): TemplateDocument {
  const g = layout.geometry;
  const { width: W, height: H } = layout.canvas;
  const u = Math.min(W, H);
  const overlay = layout.kind === 'overlay';
  const palette: Record<ColorRole | 'paper' | 'background', string> = {
    ink: style.ink,
    accent: style.accent,
    secondary: style.secondary,
    paper: style.paper,
    background: style.background,
  };
  const lightStyle = relativeLuminance(style.background) >= relativeLuminance(style.ink);
  const deep = lightStyle ? mix(style.ink, '#000000', 0.2) : mix(style.background, '#000000', 0.55);

  const elements: TemplateElement[] = [];
  let n = 0;
  const nextId = (prefix: string) => `${prefix}-${n++}`;

  const rect = (b: Box, fill: string, o: { radius?: number; rotation?: number; opacity?: number } = {}): Shape => ({
    ...base,
    id: nextId('shape'),
    type: 'shape',
    shape: 'rect',
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    fill,
    stroke: null,
    strokeWidth: 0,
    cornerRadius: o.radius ?? 0,
    ...(o.rotation ? { rotation: o.rotation } : {}),
    ...(o.opacity === undefined ? {} : { opacity: o.opacity }),
  });

  const deco = (d: Deco): Shape => {
    const b: Box = d;
    const shape = d.shape ?? 'rect';
    const common = { ...rect(b, TRANSPARENT, { radius: d.radius, rotation: d.rotation }), shape };
    switch (d.role) {
      case 'panel':
        return { ...common, fill: style.secondary };
      case 'paper':
        return { ...common, fill: style.paper };
      case 'shade':
        return { ...common, fill: '#00000024' };
      case 'film':
        return { ...common, fill: deep };
      case 'hole':
        return { ...common, fill: style.paper };
      case 'rule':
        return { ...common, fill: style.accent };
      case 'cut':
        return { ...common, fill: withAlpha(style.ink, 0.4) };
      case 'tint':
        return { ...common, fill: withAlpha(style.background, 0.9) };
      case 'band':
        return { ...common, fill: style.accent };
      case 'line':
        return { ...common, fill: TRANSPARENT, stroke: style.accent, strokeWidth: d.stroke ?? 2 };
    }
  };

  /* ---- under the photos: page border, text panel, layout shapes, photo mats ---- */
  if (!overlay && g.border && style.border !== 'none') {
    const inset = 36;
    const w = Math.max(2, Math.round(u * 0.004));
    const line = (offset: number, strokeWidth: number): Shape => ({
      ...rect({ x: offset, y: offset, width: W - 2 * offset, height: H - 2 * offset }, TRANSPARENT, {
        radius: style.radius === 2 ? Math.round(u * 0.012) : 0,
      }),
      stroke: style.accent,
      strokeWidth,
    });
    elements.push(line(inset, w));
    if (style.border === 'double') elements.push(line(inset + Math.round(w * 3.2), Math.max(1, Math.round(w / 2))));
  }

  const panelPad = Math.round(u * 0.02);
  const onPanel = style.footerPanel && g.textBox ? g.textBox : null;
  if (onPanel)
    elements.push(
      rect(
        {
          x: onPanel.x - panelPad,
          y: onPanel.y - panelPad,
          width: onPanel.width + 2 * panelPad,
          height: onPanel.height + 2 * panelPad,
        },
        style.secondary,
        { radius: Math.round(u * 0.02) },
      ),
    );

  const decoWanted = (d: Deco) => style.rules || d.role !== 'rule';
  for (const d of g.decos) if (!d.front && decoWanted(d)) elements.push(deco(d));

  const matWidth = style.mat === 0 ? 0 : Math.round(u * (style.mat === 1 ? 0.007 : 0.013));
  const cornerOf = (p: PhotoSlot) => p.radius ?? Math.round(u * [0, 0.012, 0.03][style.radius]!);
  if (matWidth)
    for (const p of g.photos)
      if (!p.plain)
        elements.push(
          rect(
            {
              x: p.x - matWidth,
              y: p.y - matWidth,
              width: p.width + 2 * matWidth,
              height: p.height + 2 * matWidth,
            },
            palette[style.matColor],
            { radius: cornerOf(p) + matWidth, rotation: p.rotation },
          ),
        );

  /* ---- photos ---- */
  g.photos.forEach((p, i) =>
    elements.push({
      ...base,
      id: `photo-${i}`,
      type: 'photo',
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      shot: p.shot,
      fit: 'cover',
      cornerRadius: cornerOf(p),
      filterId: null,
      ...(p.rotation ? { rotation: p.rotation } : {}),
    }),
  );

  /* ---- over the photos: rings, see-through grounds ---- */
  for (const d of g.decos) if (d.front && decoWanted(d)) elements.push(deco(d));

  /* ---- ornaments ---- */
  const counts: Partial<Record<OrnamentZone['role'], number>> = {};
  for (const z of g.ornaments) {
    const rule = style.ornaments[z.role];
    if (!rule) continue;
    const k = counts[z.role] ?? 0;
    counts[z.role] = k + 1;
    const name = rule.names[k % rule.names.length]!;
    const b = shrink(z, rule.scale ?? 1);
    // Corner flourishes turn with their corner; stickers sit a little askew.
    const rotation =
      z.role === 'corner' && name === 'corner' ? (z.rotation ?? 0) : z.role === 'sticker' ? (k % 2 ? 10 : -10) : 0;
    elements.push({
      ...base,
      id: nextId('ornament'),
      type: 'ornament',
      ornament: name,
      color: palette[rule.color],
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      ...(rotation ? { rotation } : {}),
    });
  }

  /* ---- text ---- */
  const textColor = (zone: TextZone, pick: 'ink' | 'accent'): string =>
    zone.surface === 'accent' ? onAccent(style.accent) : onPanel && contains(onPanel, zone) ? style.ink : palette[pick];
  const text = (
    id: string,
    zone: TextZone,
    value: string,
    spec: FontSpec,
    size: number,
    color: string,
    vertical: 'top' | 'middle' | 'bottom',
  ): TemplateElement => ({
    ...base,
    id,
    type: 'text',
    x: zone.x,
    y: zone.y,
    width: zone.width,
    height: zone.height,
    text: value,
    fontFamily: spec.family,
    fontWeight: spec.weight,
    fontStyle: spec.italic ? 'italic' : 'normal',
    fontSize: size,
    lineHeight: 1.1,
    letterSpacing: Math.round(spec.tracking * size * 10) / 10,
    color,
    align: zone.align,
    verticalAlign: vertical,
    uppercase: spec.uppercase ?? false,
    autoFit: true,
  });
  const adjacent = g.subtitle !== null && Math.abs(g.subtitle.y - (g.title.y + g.title.height)) <= g.title.height * 0.3;
  elements.push(
    text(
      'title',
      g.title,
      style.title,
      style.display,
      Math.max(8, Math.round(Math.min(g.title.height * 0.8, u * 0.13) * style.display.scale)),
      textColor(g.title, style.titleColor),
      adjacent ? 'bottom' : 'middle',
    ),
  );
  if (g.subtitle)
    elements.push(
      text(
        'date',
        g.subtitle,
        style.subtitle,
        style.body,
        // A date is about 15 characters: keep it on one line in a narrow panel.
        Math.max(
          8,
          Math.round(
            Math.min(g.subtitle.height * 0.62, u * 0.034, g.subtitle.width / (15 * (0.6 + style.body.tracking))) *
              style.body.scale,
          ),
        ),
        textColor(g.subtitle, style.subtitleColor),
        adjacent ? 'top' : 'middle',
      ),
    );

  /* ---- the guest QR: dark modules on a light plate, whatever the page colour ---- */
  g.qrs.forEach((q, i) =>
    elements.push({
      ...base,
      id: g.qrs.length > 1 ? `qr-${i}` : 'qr',
      type: 'qr',
      x: q.x,
      y: q.y,
      width: q.width,
      height: q.height,
      dark: lightStyle ? style.ink : style.background,
      light: lightStyle ? style.paper : style.ink,
      showCode: true,
    }),
  );

  return {
    canvas: {
      width: W,
      height: H,
      dpi: overlay ? 72 : 300,
      printSize: overlay ? null : (layout.size as PrintSize),
      background: overlay ? TRANSPARENT : style.background,
      backgroundAssetId: null,
    },
    elements,
  };
}

/** Freeze a document all the way down. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

/** Layouts for each print size, in the order styles walk them (every layout is used by several styles). */
const PRINT_POOLS = PRINT_SIZES.map((s) => layoutsForSize(s));
const OVERLAY_POOLS = ASPECTS.map((a) => layoutsForSize(a));

function generate(): BuiltinTemplate[] {
  const out: BuiltinTemplate[] = [];
  const add = (style: LibraryStyle, layout: LibraryLayout) => {
    const common = {
      id: `lib:${style.category}:${style.id}:${layout.id}` as const,
      category: style.category,
      style: style.id,
      layoutId: layout.id,
      shots: layout.shots,
      doc: deepFreeze(build(style, layout)),
    };
    out.push(
      layout.kind === 'layout'
        ? { ...common, kind: 'layout', printSize: layout.size as PrintSize }
        : { ...common, kind: 'overlay', aspect: layout.size as Aspect },
    );
  };
  LIBRARY_STYLES.forEach((style, i) => {
    // One layout per print size, walking each size's list so neighbouring styles differ...
    PRINT_POOLS.forEach((pool, k) => add(style, pool[(i + k * 3) % pool.length]!));
    // ...and two overlays on different aspects.
    for (const j of [0, 1]) {
      const pool = OVERLAY_POOLS[(i + j) % OVERLAY_POOLS.length]!;
      add(style, pool[(Math.floor(i / 3) + j * 2) % pool.length]!);
    }
  });
  return out;
}

/**
 * All built-in templates. The pure-call annotation lets a bundle that never imports them drop the
 * work of building them.
 */
export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = /* @__PURE__ */ generate();

const byId = new Map(BUILTIN_TEMPLATES.map((t) => [t.id as string, t]));

/** A built-in by id (`lib:…`), or undefined for any other id. */
export const builtinTemplate = (id: string): BuiltinTemplate | undefined => byId.get(id);
