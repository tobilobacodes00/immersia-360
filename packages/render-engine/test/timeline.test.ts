import { describe, expect, it } from 'vitest';
import {
  buildSourceTimes,
  frameAtOrBefore,
  frameRuns,
  needsInterpolation,
  resolveFrames,
  timelineDuration,
  uniformPts,
  type TimelineInput,
} from '../src/timeline';

const base: TimelineInput = {
  durationS: 8,
  outputFps: 30,
  slowMotion: { enabled: false, startS: 0, endS: 0, speed: 1 },
  reverse: 'none',
};

const build = (input: TimelineInput, sourceFps = 60) =>
  resolveFrames(buildSourceTimes(input), uniformPts(Math.round(input.durationS * sourceFps), sourceFps));

describe('buildSourceTimes / resolveFrames', () => {
  it('normal speed: one output frame per 1/outputFps of source, real frames only', () => {
    const tl = build(base);
    expect(tl).toHaveLength(240);
    expect(timelineDuration(tl, 30)).toBeCloseTo(8, 5);
    expect(tl.every((f) => f.b === null)).toBe(true);
    expect(tl[1]!.a).toBe(2); // a 60 fps source shown at 30 fps
  });

  it('VID-1: a 2 s segment at 0.5× adds 2 s of output', () => {
    expect(
      timelineDuration(build({ ...base, slowMotion: { enabled: true, startS: 2, endS: 4, speed: 0.5 } }), 30),
    ).toBeCloseTo(10, 1);
  });

  it('VID-1: 0.125× stretches a 1 s segment to 8 s', () => {
    const tl = build({ ...base, durationS: 3, slowMotion: { enabled: true, startS: 1, endS: 2, speed: 0.125 } });
    expect(timelineDuration(tl, 30)).toBeCloseTo(10, 1);
  });

  it('VID-2: 60 fps at 0.25× into 30 fps blends between neighbouring real frames', () => {
    const tl = build({ ...base, slowMotion: { enabled: true, startS: 2, endS: 4, speed: 0.25 } });
    const slowed = tl.filter((f) => f.t >= 2 && f.t < 4);
    expect(slowed.filter((f) => f.b !== null).length).toBeGreaterThan(slowed.length * 0.4);
    for (const f of slowed) if (f.b !== null) expect(f.b).toBe(f.a + 1);
  });

  it('acceptance #2: no repeated source frame inside a slowed segment', () => {
    for (const [sourceFps, speed] of [
      [30, 0.25],
      [60, 0.25],
      [60, 0.125],
      [120, 0.25],
      [240, 0.125],
    ] as const) {
      const tl = build({ ...base, slowMotion: { enabled: true, startS: 2, endS: 4, speed } }, sourceFps);
      const slowed = tl.filter((f) => f.t >= 2.05 && f.t < 3.95);
      for (let i = 1; i < slowed.length; i++) {
        const prev = slowed[i - 1]!;
        const cur = slowed[i]!;
        expect(
          prev.b === null && cur.b === null && prev.a === cur.a,
          `${sourceFps} fps at ${speed}× repeats ${cur.a}`,
        ).toBe(false);
      }
    }
  });

  it('VID-2: a 240 fps source at 0.125× into 30 fps uses only real frames', () => {
    expect(needsInterpolation(240, 30, 0.125)).toBe(false);
    const tl = build({ ...base, slowMotion: { enabled: true, startS: 2, endS: 4, speed: 0.125 } }, 240);
    expect(tl.every((f) => f.b === null)).toBe(true);
  });

  it('variable frame rate: blend factors follow the real frame spacing', () => {
    // Frames at 0, 0.03, 0.05, 0.1 s (irregular, like MediaRecorder on a busy phone).
    const pts = Float64Array.from([0, 0.03, 0.05, 0.1]);
    const [f] = resolveFrames([0.075], pts);
    expect(f).toMatchObject({ a: 2, b: 3 });
    expect(f!.alpha).toBeCloseTo(0.5, 5);
    // 0.0305 s is 2.5% of the way from frame 1 to 2: within the snap, so frame 1 itself.
    expect(resolveFrames([0.0305], pts)[0]).toMatchObject({ a: 1, b: null });
  });

  it('VID-3 reverse: forward then backward, ending where it started', () => {
    const tl = build({ ...base, durationS: 2, reverse: 'reverse' });
    expect(tl[0]!.a).toBe(0);
    expect(tl.at(-1)!.a).toBe(0);
    expect(tl).toHaveLength(60 + 59);
  });

  it('VID-3 boomerang: bounces the slow-motion segment, then finishes the clip', () => {
    const times = buildSourceTimes({
      ...base,
      durationS: 4,
      slowMotion: { enabled: true, startS: 1, endS: 2, speed: 0.5 },
      reverse: 'boomerang',
    });
    let decreasing = 0;
    for (let i = 1; i < times.length; i++) if (times[i]! < times[i - 1]!) decreasing++;
    expect(decreasing).toBe(59);
    expect(times.at(-1)).toBeGreaterThan(3.9);
  });

  it('clamps a slow-motion segment that runs past the take', () => {
    expect(
      timelineDuration(
        build({ ...base, durationS: 3, slowMotion: { enabled: true, startS: 2, endS: 9, speed: 0.5 } }),
        30,
      ),
    ).toBeCloseTo(4, 1);
  });

  it('returns nothing for a broken input instead of looping', () => {
    expect(buildSourceTimes({ ...base, durationS: 0 })).toEqual([]);
    expect(buildSourceTimes({ ...base, outputFps: 0 })).toEqual([]);
    expect(resolveFrames([0.1], new Float64Array(0))).toEqual([]);
  });

  it('never points past the last frame', () => {
    expect(resolveFrames([100], uniformPts(480, 60))[0]).toMatchObject({ a: 479, b: null });
  });
});

describe('frameAtOrBefore', () => {
  it('binary-searches presentation timestamps', () => {
    const pts = uniformPts(100, 10);
    expect(frameAtOrBefore(pts, -1)).toBe(0);
    expect(frameAtOrBefore(pts, 0.55)).toBe(5);
    expect(frameAtOrBefore(pts, 0.5)).toBe(5);
    expect(frameAtOrBefore(pts, 99)).toBe(99);
  });
});

describe('frameRuns', () => {
  it('a forward-only timeline is one forward run', () => {
    expect(frameRuns(build(base))).toEqual([{ direction: 'forward', start: 0, end: 240 }]);
  });

  it('reverse splits into forward then backward', () => {
    const runs = frameRuns(build({ ...base, durationS: 2, reverse: 'reverse' }));
    expect(runs.map((r) => r.direction)).toEqual(['forward', 'backward']);
    expect(runs[1]!.end).toBe(119);
  });

  it('boomerang is forward, backward, forward', () => {
    const tl = build({
      ...base,
      durationS: 4,
      slowMotion: { enabled: true, startS: 1, endS: 2, speed: 0.5 },
      reverse: 'boomerang',
    });
    expect(frameRuns(tl).map((r) => r.direction)).toEqual(['forward', 'backward', 'forward']);
  });
});
