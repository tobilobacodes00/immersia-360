import { VideoSampleSink } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import { Compositor } from '../src/gl/compositor';
import { probeTake } from '../src/probe';
import { BAND, H, W, bandError, idealAndCrossfade, makeClip, readIndex } from './fixtures';

/**
 * Diagnostics for the end-to-end golden clip: the same interpolation as compositor.browser.test.ts,
 * but on frames decoded from the H.264 clip, pair by pair. Separates "the decoded frame is off"
 * from "the flow on decoded frames is off".
 */
const geo = { width: W, height: H, rotation: 0 as const };

describe('interpolation on decoded H.264 frames (VID-2 diagnostics)', () => {
  it('reports per-pair decode and interpolation error', async () => {
    const clip = await makeClip(60, 30);
    const probe = await probeTake(clip);
    const sink = new VideoSampleSink(probe.video);
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const band = () => ctx.getImageData(0, BAND.top, W, BAND.height).data;
    const at = (i: number) => probe.firstTimestamp + (probe.pts[i]! + (probe.pts[i + 1] ?? probe.pts[i]! + 0.033)) / 2;
    const lines: string[] = [];
    let worst = 0;
    try {
      for (const a of [20, 21, 30, 31, 32, 38, 39]) {
        const [sa, sb] = [await sink.getSample(at(a)), await sink.getSample(at(a + 1))];
        if (!sa || !sb) throw new Error(`missing frame ${a}`);
        // How faithful the decoded frames are, and which index they carry.
        sa.draw(ctx, 0, 0, W, H);
        const ia = readIndex(ctx);
        const decA = bandError(band(), idealAndCrossfade(a, 0).ideal);
        sb.draw(ctx, 0, 0, W, H);
        const ib = readIndex(ctx);
        const decB = bandError(band(), idealAndCrossfade(a + 1, 0).ideal);
        // Interpolate between them.
        const comp = new Compositor(new OffscreenCanvas(W, H), W, H);
        const fa = sa.toVideoFrame();
        const fb = sb.toVideoFrame();
        const errs: string[] = [];
        try {
          for (const t of [0.25, 0.5, 0.75]) {
            comp.drawBlend(fa, fb, t, geo, `${a}`);
            ctx.drawImage(comp.canvas, 0, 0);
            const err = bandError(band(), idealAndCrossfade(a, t).ideal);
            worst = Math.max(worst, err);
            errs.push(err.toFixed(1));
          }
          if (a === 20 || a === 31 || a === 39) {
            // Where it goes wrong: flow x and synthesis error per eighth of the band, per level.
            const eighth = (k: number) => ({ x0: (k * W) / 8, x1: ((k + 1) * W) / 8 });
            for (const level of [3, 2, 1, 0, undefined]) {
              const f = comp.readFlow(level)!;
              const sx = W / f.width;
              const sy = H / f.height;
              const ys = [Math.ceil((BAND.top + 24) / sy), Math.floor((BAND.top + BAND.height - 24) / sy)] as const;
              const tiles = Array.from({ length: 8 }, (_, k) => {
                const { x0, x1 } = eighth(k);
                let sum = 0;
                let n = 0;
                for (let y = ys[0]; y < ys[1]; y++)
                  for (let x = Math.ceil(x0 / sx); x < Math.floor(x1 / sx); x++) {
                    sum += f.ab[(y * f.width + x) * 2]!;
                    n++;
                  }
                return ((sum / n) * sx).toFixed(1);
              });
              lines.push(`    ${a} ${level === undefined ? 'smoothed' : `L${level}`} A→B x: ${tiles.join(' ')}`);
            }
            comp.drawBlend(fa, fb, 0.5, geo, `${a}`);
            ctx.drawImage(comp.canvas, 0, 0);
            const ideal = idealAndCrossfade(a, 0.5).ideal;
            const got = band();
            const tileErr = Array.from({ length: 8 }, (_, k) => {
              const { x0, x1 } = eighth(k);
              let sum = 0;
              let n = 0;
              for (let y = 0; y < BAND.height; y++)
                for (let x = x0; x < x1; x++) {
                  const p = (y * W + x) * 4;
                  sum +=
                    Math.abs(got[p]! - ideal[p]!) +
                    Math.abs(got[p + 1]! - ideal[p + 1]!) +
                    Math.abs(got[p + 2]! - ideal[p + 2]!);
                  n += 3;
                }
              return (sum / n).toFixed(1);
            });
            lines.push(`    ${a} synth error per eighth at t=0.5: ${tileErr.join(' ')}`);
          }
        } finally {
          fa.close();
          fb.close();
          sa.close();
          sb.close();
          comp.dispose();
        }
        lines.push(
          `pair ${a}/${a + 1}: decoded idx ${ia}/${ib}, decode err ${decA.toFixed(1)}/${decB.toFixed(1)}, interp ${errs.join(' ')}`,
        );
      }
    } finally {
      probe.input.dispose();
    }
    console.warn(`[decoded pairs]\n  ${lines.join('\n  ')}`);
    expect(lines.length).toBeGreaterThan(7);
    // Kept as a guard once understood; for now the numbers are what matter.
    expect(worst).toBeLessThan(60);
  });
});
