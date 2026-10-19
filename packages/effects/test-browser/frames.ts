import { DEFAULT_PARAMS, type Frame, type RenderParams } from './effect-host';

/** Test frame size: small enough for a software renderer, big enough for glints and edges to land on pixels. */
export const W = 320;
export const H = 180;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * A synthetic frame: a dim bluish gradient with a fine checker (so edge-based effects see detail), a
 * bright disc and a dark magenta "body" under it. `shapeX` (0..1 of the width) places the subject, so
 * history frames can show it somewhere else. Every background channel stays at 40 or above, which lets
 * the tests treat near-black output as a defect (NaN reads back as 0).
 */
export function makeFrame(shapeX: number, width = W, height = H): Frame {
  const data = new Uint8Array(width * height * 4);
  const cx = shapeX * width;
  const cy = 0.55 * height;
  const radius = 0.16 * height;
  const cell = Math.max(1, Math.round((8 * height) / 180));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const v = y / (height - 1);
      const check = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 6 : -6;
      let r = 46 + 60 * u + 14 * v + check;
      let g = 58 + 40 * v + 10 * u + check;
      let b = 104 + 30 * (1 - u) + 20 * v + check;
      const body = clamp01(
        0.5 - (Math.hypot((x - cx) / (0.3 * height), (y + 0.1 * height) / (0.62 * height)) - 1) * 40,
      );
      r = mix(r, 150, body);
      g = mix(g, 60, body);
      b = mix(b, 100, body);
      const disc = clamp01(radius + 0.5 - Math.hypot(x - cx, y - cy));
      r = mix(r, 250, disc);
      g = mix(g, 232, disc);
      b = mix(b, 205, disc);
      const i = (y * width + x) * 4;
      data[i] = Math.round(r);
      data[i + 1] = Math.round(g);
      data[i + 2] = Math.round(b);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** A uniform frame (for the strobe's black-frame peak check). */
export function solidFrame(value: number, width = W, height = H): Frame {
  const data = new Uint8Array(width * height * 4).fill(value);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
}

/** The current frame and the four before it: the subject walks right by 6 % of the width per frame. */
export function makeScene(width = W, height = H) {
  const source = makeFrame(0.55, width, height);
  const history = [0.49, 0.43, 0.37, 0.31].map((x) => makeFrame(x, width, height));
  return { source, history };
}

/** A beat grid like the host's: phase 0..1 within the beat, and a pulse that is 1 on the beat and gone by 80 % of it. */
export function beatAt(time: number, bpm: number): { beat: number; pulse: number } {
  const beat = (time * bpm) / 60 - Math.floor((time * bpm) / 60);
  return { beat, pulse: Math.max(0, 1 - beat / 0.8) ** 2 };
}

export const ON_BEAT = { beat: 0, pulse: 1 } as const;
export const OFF_BEAT = { beat: 0.75, pulse: 0 } as const;

export function params(overrides: Partial<RenderParams> = {}): RenderParams {
  return { ...DEFAULT_PARAMS, ...overrides };
}

// ---------------------------------------------------------------------------------------------
// Metrics over RGBA8 readbacks (alpha is ignored unless a function says otherwise).

export function meanLuma(px: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
  return sum / (px.length / 4);
}

/** Largest R, G or B value anywhere. */
export function maxChannel(px: Uint8Array): number {
  let max = 0;
  for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i]!, px[i + 1]!, px[i + 2]!);
  return max;
}

/** Largest per-channel difference between two readbacks. */
export function maxDiff(a: Uint8Array, b: Uint8Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i += 4)
    for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(a[i + c]! - b[i + c]!));
  return max;
}

/** Number of pixels whose largest channel difference exceeds `threshold`. */
export function countDiff(a: Uint8Array, b: Uint8Array, threshold: number): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!));
    if (d > threshold) n++;
  }
  return n;
}

/**
 * How many of twelve 30-degree hue bins the strongly changed, saturated pixels fall in: a multicoloured
 * effect spreads over many, a single-colour one over one or two (and a grey one over none).
 */
export function hueBins(out: Uint8Array, src: Uint8Array, threshold: number, minChroma: number): number {
  const bins = new Set<number>();
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]!;
    const g = out[i + 1]!;
    const b = out[i + 2]!;
    const change = Math.max(Math.abs(r - src[i]!), Math.abs(g - src[i + 1]!), Math.abs(b - src[i + 2]!));
    if (change <= threshold || Math.max(r, g, b) - Math.min(r, g, b) < minChroma) continue;
    const hue = (Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180) / Math.PI;
    bins.add(Math.floor(((hue + 360) % 360) / 30));
  }
  return bins.size;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Mean of (out - src) in R minus the same in B, over pixels that changed by more than `threshold`: > 0 means warm light was added. */
export function warmthOfChange(
  out: Uint8Array,
  src: Uint8Array,
  threshold: number,
): { warmth: number; changed: number } {
  let warmth = 0;
  let changed = 0;
  for (let i = 0; i < out.length; i += 4) {
    const dr = out[i]! - src[i]!;
    const dg = out[i + 1]! - src[i + 1]!;
    const db = out[i + 2]! - src[i + 2]!;
    if (Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)) > threshold) {
      warmth += dr - db;
      changed++;
    }
  }
  return { warmth: changed ? warmth / changed : 0, changed };
}
