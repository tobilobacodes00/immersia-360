import { describe, expect, it } from 'vitest';
import {
  CUT_THRESHOLD,
  MATTE,
  MaskThrottle,
  TEMPORAL_BASE,
  blendMask,
  blurSigma,
  blurSize,
  featherSigma,
  gaussianLinearTaps,
  isMaskCut,
  loopTimes,
  maskDifference,
  parseHexColor,
  smoothstep,
  temporalWeight,
  type PersonMask,
} from '../src/background-math';
import { coverCrop } from '../src/gl/crop';

describe('cover-crop maths (backgrounds are scaled to cover the frame)', () => {
  it('an image of the output aspect is not cropped', () => {
    const c = coverCrop(1600, 900, 0, 1920, 1080);
    expect(c.scale[0]).toBeCloseTo(1);
    expect(c.scale[1]).toBeCloseTo(1);
    expect(c.offset[0]).toBeCloseTo(0);
    expect(c.offset[1]).toBeCloseTo(0);
  });

  it('a wider image loses its sides, centred', () => {
    // 2:1 into 1:1: the output shows the middle half of the width.
    const c = coverCrop(2000, 1000, 0, 1000, 1000);
    expect(c.scale[0]).toBeCloseTo(0.5);
    expect(c.scale[1]).toBeCloseTo(1);
    expect(c.offset[0]).toBeCloseTo(0.25);
    expect(c.offset[1]).toBeCloseTo(0);
  });

  it('a taller image loses its top and bottom, centred', () => {
    // 1:2 into 1:1: the middle half of the height.
    const c = coverCrop(500, 1000, 0, 1000, 1000);
    expect(c.scale[0]).toBeCloseTo(1);
    expect(c.scale[1]).toBeCloseTo(0.5);
    expect(c.offset[1]).toBeCloseTo(0.25);
  });

  it('never leaves bars: the visible window stays inside the image for any aspects', () => {
    for (const [sw, sh] of [
      [1920, 1080],
      [1080, 1920],
      [1000, 1000],
      [4000, 300],
      [300, 4000],
    ] as const)
      for (const [ow, oh] of [
        [1080, 1920],
        [1920, 1080],
        [1080, 1080],
      ] as const) {
        const { scale, offset } = coverCrop(sw, sh, 0, ow, oh);
        for (const [s, o] of [
          [scale[0], offset[0]],
          [scale[1], offset[1]],
        ] as const) {
          expect(s).toBeLessThanOrEqual(1 + 1e-9);
          expect(o).toBeGreaterThanOrEqual(-1e-9);
          expect(o + s).toBeLessThanOrEqual(1 + 1e-9);
          expect(o * 2 + s).toBeCloseTo(1); // centred
        }
        // Exactly one axis is cropped, unless the aspects match.
        expect(Math.min(scale[0], scale[1])).toBeLessThanOrEqual(1);
        expect(Math.max(scale[0], scale[1])).toBeCloseTo(1);
      }
  });

  it('a video recorded on its side (rotation 90 or 270) covers by its displayed size', () => {
    const upright = coverCrop(1080, 1920, 0, 1080, 1920);
    for (const rotation of [90, 270] as const) expect(coverCrop(1920, 1080, rotation, 1080, 1920)).toEqual(upright);
    // And 180 changes nothing about the crop (only which way the picture faces).
    expect(coverCrop(1920, 1080, 180, 1080, 1920)).toEqual(coverCrop(1920, 1080, 0, 1080, 1920));
  });
});

describe('temporal smoothing of the person mask', () => {
  it('averages away jitter and follows real movement at once', () => {
    expect(temporalWeight(0)).toBeCloseTo(TEMPORAL_BASE);
    expect(temporalWeight(0.1)).toBeCloseTo(TEMPORAL_BASE);
    expect(temporalWeight(0.7)).toBeCloseTo(1);
    expect(temporalWeight(1)).toBe(1);
    // A drop looks the same as a rise.
    expect(temporalWeight(-0.5)).toBeCloseTo(temporalWeight(0.5));
  });

  it('the weight only grows with the size of the change', () => {
    let last = 0;
    for (let d = 0; d <= 1.0001; d += 0.05) {
      const w = temporalWeight(d);
      expect(w).toBeGreaterThanOrEqual(last - 1e-12);
      expect(w).toBeGreaterThanOrEqual(TEMPORAL_BASE);
      expect(w).toBeLessThanOrEqual(1);
      last = w;
    }
  });

  it('damps an edge that wobbles between two nearby values (flicker)', () => {
    // A pixel on the person's edge whose raw value alternates 0.4 / 0.6 from frame to frame.
    const raw = Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.6 : 0.4));
    const out: number[] = [raw[0]!];
    for (let i = 1; i < raw.length; i++) out.push(blendMask(out[i - 1]!, raw[i]!));
    const swing = (xs: number[]) => Math.max(...xs.slice(10)) - Math.min(...xs.slice(10));
    expect(swing(raw)).toBeCloseTo(0.2);
    expect(swing(out)).toBeLessThan(swing(raw) / 2);
  });

  it('does not trail behind a pixel that really changes', () => {
    // A hand sweeping in: the pixel goes 0 → 1 in one frame and must be there on that frame.
    expect(blendMask(0, 1)).toBeCloseTo(1);
    // A big but not total change is followed within a frame as well.
    expect(blendMask(0.1, 0.9)).toBeGreaterThan(0.85);
    // A moderate change closes most of the gap within three frames.
    let v = 0.2;
    for (let i = 0; i < 3; i++) v = blendMask(v, 0.6);
    expect(v).toBeGreaterThan(0.55);
  });

  it('a mask that is unchanged stays put', () => {
    expect(blendMask(0.37, 0.37)).toBeCloseTo(0.37);
  });

  it('a cut is a mask that differs from the last by a fifth or more, or in size', () => {
    const mask = (v: number, w = 4, h = 4): PersonMask => ({
      data: new Float32Array(w * h).fill(v),
      width: w,
      height: h,
    });
    expect(isMaskCut(null, mask(0))).toBe(true);
    expect(isMaskCut(mask(0.5), mask(0.52))).toBe(false);
    expect(isMaskCut(mask(0), mask(CUT_THRESHOLD + 0.01))).toBe(true);
    expect(isMaskCut(mask(0, 4, 4), mask(0, 8, 8))).toBe(true);
    expect(maskDifference(new Float32Array([0, 1]), new Float32Array([1, 1]))).toBeCloseTo(0.5);
    expect(maskDifference(new Float32Array(2), new Float32Array(3))).toBe(1);
  });
});

describe('matte, feather and blur parameters', () => {
  it('the matte is a rising smoothstep inside (0, 1) that trims the unsure fringe', () => {
    expect(smoothstep(MATTE[0], MATTE[1], 0.2)).toBe(0);
    expect(smoothstep(MATTE[0], MATTE[1], 0.9)).toBe(1);
    expect(smoothstep(MATTE[0], MATTE[1], 0.5)).toBeLessThan(0.5); // a coin-toss pixel is mostly background
    expect(MATTE[0]).toBeLessThan(MATTE[1]);
  });

  it('feathers by about a pixel at 1080 rows, within what the 9-tap blur can do', () => {
    expect(featherSigma(1080)).toBeCloseTo(1.3, 1);
    for (const h of [240, 480, 1080, 1920, 3840]) {
      expect(featherSigma(h)).toBeGreaterThanOrEqual(0.9);
      expect(featherSigma(h)).toBeLessThanOrEqual(2.2);
    }
  });

  it('blurs the backdrop at an eighth size, with a sigma the 13-tap kernel can do', () => {
    expect(blurSize(1080, 1920)).toEqual({ width: 135, height: 240 });
    expect(blurSize(1, 1)).toEqual({ width: 8, height: 8 });
    for (const h of [240, 1080, 1920, 3840]) {
      expect(blurSigma(h)).toBeGreaterThanOrEqual(0.8);
      expect(blurSigma(h)).toBeLessThanOrEqual(3);
    }
    // More output rows, more blur, in proportion (until the kernel's limit).
    expect(blurSigma(1920)).toBeGreaterThan(blurSigma(960));
  });
});

describe('Gaussian blur in pairs of taps (what the feather and the blurred backdrop run on)', () => {
  /** Linear interpolation of a sampled signal, the way a bilinear texture fetch does it. */
  const lerp = (f: number[], x: number) => {
    const i = Math.floor(x);
    const t = x - i;
    return f[i]! * (1 - t) + f[i + 1]! * t;
  };

  it('the weights add up to one', () => {
    for (const [sigma, pairs] of [
      [0.9, 2],
      [2.2, 2],
      [0.8, 3],
      [3, 3],
    ] as const) {
      const t = gaussianLinearTaps(sigma, pairs);
      expect(t.pairs).toHaveLength(pairs);
      expect(t.center + 2 * t.pairs.reduce((a, p) => a + p.weight, 0)).toBeCloseTo(1, 10);
    }
  });

  it('each pair sits between its two texels, further out for each pair', () => {
    const t = gaussianLinearTaps(2, 3);
    t.pairs.forEach((p, i) => {
      expect(p.offset).toBeGreaterThan(2 * i + 1);
      expect(p.offset).toBeLessThan(2 * i + 2);
    });
  });

  it('gives the same result as the full kernel, with half the fetches', () => {
    // A bumpy signal, blurred directly with a 9-wide (±4) normalised Gaussian and with 5 pair-taps.
    const signal = Array.from({ length: 64 }, (_, i) => Math.sin(i * 0.9) * 40 + (i % 7) * 11 + 100);
    for (const sigma of [0.9, 1.5, 2.2]) {
      const t = gaussianLinearTaps(sigma, 2);
      const kernel = Array.from({ length: 9 }, (_, i) => Math.exp(-((i - 4) ** 2) / (2 * sigma * sigma)));
      const total = kernel.reduce((a, b) => a + b, 0);
      for (let x = 8; x < 56; x++) {
        const direct = kernel.reduce((acc, w, i) => acc + (w / total) * signal[x + i - 4]!, 0);
        const paired =
          t.center * signal[x]! +
          t.pairs.reduce((acc, p) => acc + p.weight * (lerp(signal, x + p.offset) + lerp(signal, x - p.offset)), 0);
        expect(paired).toBeCloseTo(direct, 8);
      }
    }
  });

  it('a wider sigma spreads the weight outwards', () => {
    expect(gaussianLinearTaps(0.9, 2).center).toBeGreaterThan(gaussianLinearTaps(2.2, 2).center);
  });
});

describe('colours and video looping', () => {
  it('parses #rrggbb', () => {
    expect(parseHexColor('#000000')).toEqual([0, 0, 0]);
    expect(parseHexColor('#FFFFFF')).toEqual([1, 1, 1]);
    expect(parseHexColor('#ff8000')![1]).toBeCloseTo(128 / 255);
    for (const bad of ['', 'red', '#fff', '#12345', '#gggggg', 'ff8000', '#ff8000ff'])
      expect(parseHexColor(bad), bad).toBeNull();
  });

  it('a background clip longer than a loop is cut at the take, a shorter one is played again', () => {
    // 1 s of a 30 fps clip: 30 frames per pass, at 0, 1/30, ...
    const t = loopTimes(30, 30, 1);
    expect(t).toHaveLength(30);
    expect(t[0]).toBe(0);
    expect(t[1]).toBeCloseTo(1 / 30);
    expect(t.at(-1)!).toBeLessThan(1);
  });

  it('holds the last instant instead of reading past the end of the clip', () => {
    const t = loopTimes(10, 30, 0.2); // the clip has 6 frames' worth, asked for 10
    expect(Math.max(...t)).toBeLessThan(0.2);
    expect(t[9]).toBe(t[8]);
  });
});

describe('MaskThrottle (the live preview never segments faster than 15 fps or two at once)', () => {
  it('allows the first run, then waits out the frame budget', () => {
    const t = new MaskThrottle(15);
    expect(t.ready(0)).toBe(true);
    t.begin();
    expect(t.ready(1)).toBe(false); // one at a time
    t.end(5, 5); // took 5 ms, started at 0: the next may start at 1000/15 = 66.7 ms
    expect(t.ready(60)).toBe(false);
    expect(t.ready(67)).toBe(true);
  });

  it('never starts more than maxFps runs a second, however fast the frames come', () => {
    const t = new MaskThrottle(15);
    let runs = 0;
    for (let now = 0; now < 10_000; now += 4) {
      if (!t.ready(now)) continue;
      t.begin();
      runs++;
      t.end(2, now + 2);
    }
    expect(runs / 10).toBeLessThanOrEqual(15.5);
    expect(runs / 10).toBeGreaterThan(12);
  });

  it('backs off on a slow device so segmentation takes at most its share of the thread', () => {
    const t = new MaskThrottle(15, 0.3);
    t.begin();
    t.end(60, 60); // a run of 60 ms may use 30% of the time: the next starts 200 ms after the first
    expect(t.ready(150)).toBe(false);
    expect(t.ready(201)).toBe(true);
  });

  it('waits a second after a failure', () => {
    const t = new MaskThrottle();
    t.begin();
    t.fail(100);
    expect(t.ready(900)).toBe(false);
    expect(t.ready(1100)).toBe(true);
  });
});
