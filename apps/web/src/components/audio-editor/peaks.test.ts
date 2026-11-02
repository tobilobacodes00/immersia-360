import { describe, expect, it } from 'vitest';
import {
  MIN_TRIM_MS,
  clampTrim,
  computePeaks,
  fitMusic,
  formatTime,
  gainAt,
  peakAbs,
  rebucketPeaks,
  sameMusic,
  trimEndOrNull,
  type MusicEdit,
} from './peaks';

const f32 = (...v: number[]) => Float32Array.from(v);
const arr = (a: Float32Array) => Array.from(a);

describe('computePeaks', () => {
  it('takes the min and max of each equal slice', () => {
    // Dyadic fractions are exact in float32, so toEqual is safe.
    const { min, max } = computePeaks([f32(0, 0.5, -0.5, 0.25, 1, -1, 0.125, 0.75)], 4);
    expect(arr(min)).toEqual([0, -0.5, -1, 0.125]);
    expect(arr(max)).toEqual([0.5, 0.25, 1, 0.75]);
  });

  it('mixes channels to mono by averaging them', () => {
    const left = f32(1, 1, -1, -1);
    const right = f32(-1, -1, -1, -1);
    const { min, max } = computePeaks([left, right], 2);
    expect(arr(min)).toEqual([0, -1]);
    expect(arr(max)).toEqual([0, -1]);
  });

  it('repeats samples when there are more buckets than samples', () => {
    const { min, max } = computePeaks([f32(0.5, -0.5)], 4);
    expect(arr(min)).toEqual([0.5, 0.5, -0.5, -0.5]);
    expect(arr(max)).toEqual([0.5, 0.5, -0.5, -0.5]);
  });

  it('returns silence for no channels or empty channels', () => {
    for (const channels of [[], [new Float32Array(0)]]) {
      const { min, max } = computePeaks(channels, 8);
      expect(arr(min)).toEqual(new Array(8).fill(0));
      expect(arr(max)).toEqual(new Array(8).fill(0));
    }
  });

  it('uses the shortest channel instead of reading past it', () => {
    const { min, max } = computePeaks([f32(1, 1, 1, 1), f32(1, 1)], 2);
    expect(arr(min)).toEqual([1, 1]);
    expect(arr(max)).toEqual([1, 1]);
  });

  it('floors the bucket count and never returns zero buckets', () => {
    expect(computePeaks([f32(0.5, 0.25, 0.125)], 2.9).min).toHaveLength(2);
    expect(computePeaks([f32(0.5)], 0).min).toHaveLength(1);
    expect(computePeaks([f32(0.5)], -3).max).toHaveLength(1);
  });

  it('treats NaN samples as silence rather than poisoning the drawing', () => {
    const { min, max } = computePeaks([f32(NaN, NaN)], 1);
    expect(arr(min)).toEqual([0]);
    expect(arr(max)).toEqual([0]);
  });

  it('keeps min <= max inside the sample range on a long signal', () => {
    const length = 48_000 * 3 + 17; // not a multiple of the bucket count
    const sine = new Float32Array(length);
    for (let i = 0; i < length; i++) sine[i] = Math.sin(i / 37) * 0.8;
    const { min, max } = computePeaks([sine], 1500);
    expect(min).toHaveLength(1500);
    for (let b = 0; b < 1500; b++) {
      expect(min[b]!).toBeLessThanOrEqual(max[b]!);
      expect(Math.abs(min[b]!)).toBeLessThanOrEqual(0.8001);
      expect(Math.abs(max[b]!)).toBeLessThanOrEqual(0.8001);
    }
    expect(peakAbs({ min, max })).toBeGreaterThan(0.79);
  });
});

describe('rebucketPeaks', () => {
  const peaks = { min: f32(0, -1, -2, -3), max: f32(1, 2, 3, 4) };

  it('merges neighbouring buckets, keeping the extremes', () => {
    const r = rebucketPeaks(peaks, 2);
    expect(arr(r.min)).toEqual([-1, -3]);
    expect(arr(r.max)).toEqual([2, 4]);
  });

  it('repeats buckets when asked for more columns', () => {
    const r = rebucketPeaks(peaks, 8);
    expect(arr(r.min)).toEqual([0, 0, -1, -1, -2, -2, -3, -3]);
    expect(arr(r.max)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('is silent for empty peaks', () => {
    const r = rebucketPeaks({ min: new Float32Array(0), max: new Float32Array(0) }, 3);
    expect(arr(r.min)).toEqual([0, 0, 0]);
    expect(arr(r.max)).toEqual([0, 0, 0]);
  });
});

describe('peakAbs', () => {
  it('is the largest absolute value on either side', () => {
    expect(peakAbs({ min: f32(-0.5, 0), max: f32(0.25, 0.75) })).toBe(0.75);
    expect(peakAbs({ min: f32(-1), max: f32(0.5) })).toBe(1);
    expect(peakAbs({ min: new Float32Array(0), max: new Float32Array(0) })).toBe(0);
  });
});

describe('clampTrim', () => {
  const DURATION = 10_000;

  it('stops the start handle one gap before the end handle', () => {
    expect(clampTrim({ startMs: 9_800, endMs: 10_000 }, 'start', DURATION)).toEqual({ startMs: 9_500, endMs: 10_000 });
  });

  it('stops the end handle one gap after the start handle', () => {
    expect(clampTrim({ startMs: 2_000, endMs: 1_000 }, 'end', DURATION)).toEqual({ startMs: 2_000, endMs: 2_500 });
  });

  it('keeps both handles inside the song', () => {
    expect(clampTrim({ startMs: -400, endMs: 5_000 }, 'start', DURATION)).toEqual({ startMs: 0, endMs: 5_000 });
    expect(clampTrim({ startMs: 1_000, endMs: 12_000 }, 'end', DURATION)).toEqual({ startMs: 1_000, endMs: 10_000 });
  });

  it('pulls the start back when the end is pushed against the song end', () => {
    expect(clampTrim({ startMs: 9_800, endMs: 12_000 }, 'end', DURATION)).toEqual({ startMs: 9_500, endMs: 10_000 });
  });

  it('rounds to whole milliseconds and ignores NaN', () => {
    expect(clampTrim({ startMs: 1_000.6, endMs: 3_000.4 }, 'start', DURATION)).toEqual({
      startMs: 1_001,
      endMs: 3_000,
    });
    expect(clampTrim({ startMs: NaN, endMs: 4_000 }, 'start', DURATION)).toEqual({ startMs: 0, endMs: 4_000 });
  });

  it('keeps the whole song when it is shorter than the minimum gap', () => {
    expect(clampTrim({ startMs: 100, endMs: 200 }, 'start', 300)).toEqual({ startMs: 0, endMs: 300 });
    expect(clampTrim({ startMs: 100, endMs: 200 }, 'end', 300)).toEqual({ startMs: 0, endMs: 300 });
  });

  it('honours a custom gap', () => {
    expect(clampTrim({ startMs: 4_900, endMs: 5_000 }, 'start', DURATION, 1_000)).toEqual({
      startMs: 4_000,
      endMs: 5_000,
    });
  });

  it('always yields 0 <= start, end - start >= gap, end <= duration', () => {
    const points = [-5_000, 0, 1, 499, 500, 2_500, 9_499, 9_500, 9_999, 10_000, 15_000];
    for (const startMs of points)
      for (const endMs of points)
        for (const moved of ['start', 'end'] as const) {
          const r = clampTrim({ startMs, endMs }, moved, DURATION);
          expect(r.startMs).toBeGreaterThanOrEqual(0);
          expect(r.endMs).toBeLessThanOrEqual(DURATION);
          expect(r.endMs - r.startMs).toBeGreaterThanOrEqual(MIN_TRIM_MS);
        }
  });
});

describe('trimEndOrNull', () => {
  it('maps the end of the song to null', () => {
    expect(trimEndOrNull(10_000, 10_000)).toBeNull();
    expect(trimEndOrNull(10_001, 10_000)).toBeNull();
    expect(trimEndOrNull(9_999, 10_000)).toBe(9_999);
  });
});

describe('formatTime', () => {
  it('formats m:ss.s', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(100)).toBe('0:00.1');
    expect(formatTime(83_456)).toBe('1:23.4');
    expect(formatTime(60_000)).toBe('1:00.0');
    expect(formatTime(3_600_000)).toBe('60:00.0');
  });

  it('truncates instead of rounding up to the next second', () => {
    expect(formatTime(59_999)).toBe('0:59.9');
  });

  it('clamps nonsense to zero', () => {
    expect(formatTime(-250)).toBe('0:00.0');
    expect(formatTime(NaN)).toBe('0:00.0');
    expect(formatTime(Infinity)).toBe('0:00.0');
  });
});

describe('gainAt', () => {
  const env: [number, number][] = [
    [1, 0],
    [2, 1],
    [6, 1],
    [8, 0],
  ];

  it('interpolates along the fade in, hold and fade out', () => {
    expect(gainAt(env, 1.5)).toBeCloseTo(0.5);
    expect(gainAt(env, 4)).toBe(1);
    expect(gainAt(env, 7)).toBeCloseTo(0.5);
  });

  it('holds the end values outside the envelope', () => {
    expect(gainAt(env, 0)).toBe(0);
    expect(gainAt(env, 9)).toBe(0);
  });

  it('is silent without an envelope and tolerates zero-length segments', () => {
    expect(gainAt([], 3)).toBe(0);
    expect(
      gainAt(
        [
          [0, 0],
          [2, 1],
          [2, 1],
          [4, 0],
        ],
        2,
      ),
    ).toBe(1);
  });
});

describe('fitMusic', () => {
  const SONG = 180_000;
  const VIDEO = 8_000;
  const ok: MusicEdit = {
    trimStartMs: 12_000,
    trimEndMs: 90_000,
    offsetMs: 500,
    fadeInMs: 500,
    fadeOutMs: 1_000,
    volume: 0.9,
  };

  it('leaves valid settings alone', () => {
    expect(sameMusic(fitMusic(ok, SONG, VIDEO), ok)).toBe(true);
    expect(sameMusic(fitMusic({ ...ok, trimEndMs: null }, SONG, VIDEO), { ...ok, trimEndMs: null })).toBe(true);
  });

  it('moves a trim that belongs to a longer song back inside this one', () => {
    const fitted = fitMusic({ ...ok, trimStartMs: 200_000, trimEndMs: 250_000 }, SONG, VIDEO);
    expect(fitted.trimStartMs).toBe(SONG - MIN_TRIM_MS);
    expect(fitted.trimEndMs).toBeNull();
  });

  it('turns an end at the song end into null', () => {
    expect(fitMusic({ ...ok, trimEndMs: SONG }, SONG, VIDEO).trimEndMs).toBeNull();
  });

  it('clamps offset, fades and volume to their ranges', () => {
    const fitted = fitMusic({ ...ok, offsetMs: 9_000.4, fadeInMs: 12_000, fadeOutMs: -5, volume: 1.5 }, SONG, VIDEO);
    expect(fitted).toMatchObject({ offsetMs: VIDEO, fadeInMs: 10_000, fadeOutMs: 0, volume: 1 });
    expect(fitMusic({ ...ok, offsetMs: 1_234.6 }, SONG, VIDEO).offsetMs).toBe(1_235);
  });

  it('is idempotent', () => {
    const once = fitMusic({ ...ok, trimStartMs: 500_000, trimEndMs: 10, offsetMs: -3, volume: NaN }, SONG, VIDEO);
    expect(sameMusic(fitMusic(once, SONG, VIDEO), once)).toBe(true);
  });
});
