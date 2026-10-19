import { describe, expect, it } from 'vitest';
import { Compositor } from '../src/gl/compositor';
import { BAND, H, PAN_PX_PER_FRAME, W, bandError, drawBand, drawTestFrame, idealAndCrossfade } from './fixtures';

/**
 * The interpolator in isolation (no H.264 in the loop): the flow it estimates for known motions,
 * level by level, and how close its in-between frames come to the true image.
 */
const geo = { width: W, height: H, rotation: 0 as const };
const LEVELS = 5;

/** A test frame whose band sits at `position` (the index bars stay put). */
function bandFrame(position: number): ImageBitmap {
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d')!;
  drawTestFrame(ctx, 0);
  drawBand(ctx, position);
  return c.transferToImageBitmap();
}

/** Deterministic 2-D block noise (8 px blocks), drawn shifted by (dx, dy): a texture with no aperture problem. */
function noiseFrame(dx: number, dy: number): ImageBitmap {
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d')!;
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const B = 8;
  for (let y = -64; y < H + 64; y += B)
    for (let x = -64; x < W + 64; x += B) {
      const v = Math.round(40 + rand() * 175);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x + dx, y + dy, B, B);
    }
  return c.transferToImageBitmap();
}

function bandPixels(canvas: OffscreenCanvas): Uint8ClampedArray {
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0);
  return ctx.getImageData(0, BAND.top, W, BAND.height).data;
}

/** Mean flow over a region given in OUTPUT pixels, converted to output pixels. */
function meanFlow(
  flow: Float32Array,
  fw: number,
  fh: number,
  region: { x0: number; x1: number; y0: number; y1: number },
) {
  const sx = W / fw;
  const sy = H / fh;
  let ax = 0;
  let ay = 0;
  let n = 0;
  for (let y = Math.ceil(region.y0 / sy); y < Math.floor(region.y1 / sy); y++)
    for (let x = Math.ceil(region.x0 / sx); x < Math.floor(region.x1 / sx); x++) {
      ax += flow[(y * fw + x) * 2]!;
      ay += flow[(y * fw + x) * 2 + 1]!;
      n++;
    }
  return { x: n ? (ax / n) * sx : NaN, y: n ? (ay / n) * sy : NaN };
}

const fmt = (v: { x: number; y: number }) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)})`;

/** Estimate flow between two frames and log every level, coarsest first; returns the smoothed result. */
function estimate(label: string, a: ImageBitmap, b: ImageBitmap, region: Parameters<typeof meanFlow>[3]) {
  const comp = new Compositor(new OffscreenCanvas(W, H), W, H);
  try {
    comp.drawBlend(a, b, 0.5, geo);
    const lines: string[] = [];
    for (let l = LEVELS - 1; l >= 0; l--) {
      const f = comp.readFlow(l)!;
      lines.push(
        `L${l} ${f.width}×${f.height} A→B ${fmt(meanFlow(f.ab, f.width, f.height, region))} B→A ${fmt(meanFlow(f.ba, f.width, f.height, region))}`,
      );
    }
    const s = comp.readFlow()!;
    const ab = meanFlow(s.ab, s.width, s.height, region);
    const ba = meanFlow(s.ba, s.width, s.height, region);
    lines.push(`smoothed A→B ${fmt(ab)} B→A ${fmt(ba)}`);
    console.warn(`[flow ${label}]\n  ${lines.join('\n  ')}`);
    return { ab, ba };
  } finally {
    comp.dispose();
  }
}

const interior = { x0: 96, x1: W - 96, y0: 96, y1: H - 96 };
const bandInterior = { x0: 64, x1: W - 64, y0: BAND.top + 24, y1: BAND.top + BAND.height - 24 };

describe('optical-flow interpolator (VID-2)', () => {
  // A(x) = B(x + flow): content drawn shifted by (dx, dy) in B has flow A→B = (dx, dy).
  for (const [dx, dy] of [
    [12, 0],
    [6, -4],
  ] as const) {
    it(`recovers a (${dx}, ${dy}) px shift of a 2-D texture`, () => {
      const { ab, ba } = estimate(`noise ${dx},${dy}`, noiseFrame(0, 0), noiseFrame(dx, dy), interior);
      expect(Math.abs(ab.x - dx), `A→B x ${fmt(ab)}`).toBeLessThan(1);
      expect(Math.abs(ab.y - dy), `A→B y ${fmt(ab)}`).toBeLessThan(1);
      expect(Math.abs(ba.x + dx), `B→A x ${fmt(ba)}`).toBeLessThan(1);
      expect(Math.abs(ba.y + dy), `B→A y ${fmt(ba)}`).toBeLessThan(1);
    });
  }

  it('recovers the pan of a one-dimensional texture (aperture problem)', () => {
    // The band moves left by PAN_PX_PER_FRAME: A(x) = B(x - pan). Inside vertical stripes the
    // vertical component is unobservable (every row is the same), so only x is asserted.
    const { ab, ba } = estimate('band', bandFrame(0), bandFrame(1), bandInterior);
    expect(Math.abs(ab.x + PAN_PX_PER_FRAME), `A→B ${fmt(ab)}`).toBeLessThan(1);
    expect(Math.abs(ba.x - PAN_PX_PER_FRAME), `B→A ${fmt(ba)}`).toBeLessThan(1);
  });

  it('synthesises in-between frames far closer to the truth than a cross-fade', () => {
    const comp = new Compositor(new OffscreenCanvas(W, H), W, H);
    try {
      const a = bandFrame(4);
      const b = bandFrame(5);
      for (const t of [0.25, 0.5, 0.75]) {
        comp.drawBlend(a, b, t, geo);
        const { ideal, fade } = idealAndCrossfade(4, t);
        const interp = bandError(bandPixels(comp.canvas), ideal);
        const cross = bandError(fade, ideal);
        console.warn(`[synth] t=${t}: interpolated ${interp.toFixed(2)}, cross-fade ${cross.toFixed(2)}`);
        expect(interp, `t=${t}`).toBeLessThan(cross * 0.5);
      }
    } finally {
      comp.dispose();
    }
  });

  it('diagnostics: flow across the frame at the weakest pan positions', () => {
    // Not an assertion: where in the frame the flow goes wrong, per level, for the positions the
    // sweep below finds hardest (and one easy one for contrast).
    for (const at of [31, 36, 4]) {
      const comp = new Compositor(new OffscreenCanvas(W, H), W, H);
      try {
        comp.drawBlend(bandFrame(at), bandFrame(at + 1), 0.5, geo);
        const lines: string[] = [];
        for (const level of [3, 2, 1, 0, undefined]) {
          const f = comp.readFlow(level)!;
          const tiles = Array.from({ length: 8 }, (_, k) =>
            meanFlow(f.ab, f.width, f.height, {
              x0: (k * W) / 8,
              x1: ((k + 1) * W) / 8,
              y0: BAND.top + 24,
              y1: BAND.top + BAND.height - 24,
            }).x.toFixed(1),
          );
          lines.push(`${level === undefined ? 'smoothed' : `L${level}`}: ${tiles.join(' ')}`);
        }
        console.warn(
          `[tiles @${at}] A→B x per eighth of the frame (expect -${PAN_PX_PER_FRAME})\n  ${lines.join('\n  ')}`,
        );
      } finally {
        comp.dispose();
      }
    }
  });

  it('holds up at every position of the pan, not just a lucky one', () => {
    // The band's stripes vary in tone, so some stretches are low-contrast; sweep them all.
    const comp = new Compositor(new OffscreenCanvas(W, H), W, H);
    const results: { at: number; interp: number; cross: number }[] = [];
    try {
      for (let at = 0; at < 48; at += 1) {
        const a = bandFrame(at);
        const b = bandFrame(at + 1);
        comp.drawBlend(a, b, 0.5, geo, `${at}`);
        const { ideal, fade } = idealAndCrossfade(at, 0.5);
        results.push({ at, interp: bandError(bandPixels(comp.canvas), ideal), cross: bandError(fade, ideal) });
        a.close();
        b.close();
      }
    } finally {
      comp.dispose();
    }
    const worst = [...results].sort((x, y) => y.interp / y.cross - x.interp / x.cross).slice(0, 5);
    const mean = (k: 'interp' | 'cross') => results.reduce((s, r) => s + r[k], 0) / results.length;
    console.warn(
      `[sweep] mean interpolated ${mean('interp').toFixed(2)}, cross-fade ${mean('cross').toFixed(2)}; ` +
        `worst ${worst.map((w) => `@${w.at}=${w.interp.toFixed(1)}/${w.cross.toFixed(1)}`).join(' ')}`,
    );
    expect(mean('interp')).toBeLessThan(mean('cross') * 0.5);
    // No position may come out worse than simply blending the two frames.
    for (const r of results) expect(r.interp, `position ${r.at}`).toBeLessThan(r.cross);
  });
});
