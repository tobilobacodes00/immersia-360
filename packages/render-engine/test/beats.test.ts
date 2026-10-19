import { describe, expect, it } from 'vitest';
import { analyseBeats, beatState, beatsOnOutput, snapSlowMotion } from '../src/beats';

/** mulberry32: a small, well-mixed deterministic PRNG (test fixtures must not depend on Math.random). */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percussive clicks (noise bursts) at `bpm`, accented every bar, over a quiet held tone. */
function clicks(
  bpm: number,
  seconds: number,
  sr: number,
  opts: { offset?: number; swing?: number; gain?: number } = {},
) {
  const rnd = prng(bpm);
  const out = new Float32Array(Math.floor(seconds * sr));
  const truth: number[] = [];
  const period = 60 / bpm;
  for (let k = 0; ; k++) {
    const t = (opts.offset ?? 0.3) + k * period + (k % 2 ? (opts.swing ?? 0) : 0);
    if (t > seconds - 0.1) break;
    truth.push(t);
    const start = Math.floor(t * sr);
    const amp = (opts.gain ?? 1) * (k % 4 === 0 ? 1 : 0.6);
    for (let i = 0; i < sr * 0.08 && start + i < out.length; i++)
      out[start + i]! += (rnd() * 2 - 1) * amp * Math.exp(-i / (sr * 0.01));
  }
  for (let i = 0; i < out.length; i++) out[i]! += 0.05 * (opts.gain ?? 1) * Math.sin((2 * Math.PI * 220 * i) / sr);
  return { out, truth };
}

const hitRate = (beats: number[], truth: number[], tol = 0.03) =>
  truth.filter((t) => beats.some((b) => Math.abs(b - t) < tol)).length / truth.length;

describe('analyseBeats (VID-12)', () => {
  for (const [bpm, sr] of [
    [84, 44100],
    [97, 44100],
    [120, 48000],
    [128, 48000],
    [150, 48000],
  ] as const)
    it(`finds ${bpm} BPM and its beats at ${sr} Hz`, () => {
      const { out, truth } = clicks(bpm, 20, sr);
      const a = analyseBeats([out], sr);
      expect(a.bpm).toBeGreaterThan(bpm * 0.98);
      expect(a.bpm).toBeLessThan(bpm * 1.02);
      expect(hitRate(a.beats, truth)).toBeGreaterThanOrEqual(0.95);
      expect(a.confidence).toBeGreaterThan(0.6);
    });

  it('follows a swung beat', () => {
    const { out, truth } = clicks(110, 20, 48000, { swing: 0.06 });
    expect(hitRate(analyseBeats([out], 48000).beats, truth, 0.04)).toBeGreaterThanOrEqual(0.95);
  });

  it('analyses only the excerpt a video uses, with times from the track start', () => {
    const { out, truth } = clicks(110, 20, 48000);
    const a = analyseBeats([out], 48000, { startS: 5, durationS: 10 });
    expect(a.beats[0]).toBeGreaterThanOrEqual(5);
    expect(a.beats.at(-1)).toBeLessThanOrEqual(15.1);
    expect(
      hitRate(
        a.beats,
        truth.filter((t) => t > 5.3 && t < 14.7),
      ),
    ).toBeGreaterThanOrEqual(0.95);
  });

  it('reports no confident beat for noise or a held tone, but does for quiet music', () => {
    const sr = 48000;
    const rnd = prng(11);
    const noise = new Float32Array(sr * 12).map(() => (rnd() * 2 - 1) * 0.3);
    const tone = new Float32Array(sr * 12).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 330 * i) / sr));
    expect(analyseBeats([noise], sr).confidence).toBeLessThan(0.3);
    expect(analyseBeats([tone], sr)).toMatchObject({ confidence: 0, beats: [] });
    expect(analyseBeats([clicks(120, 12, sr, { gain: 0.01 }).out], sr).confidence).toBeGreaterThan(0.6);
  });

  it('mixes channels to mono', () => {
    const { out, truth } = clicks(120, 12, 48000);
    const silent = new Float32Array(out.length);
    expect(hitRate(analyseBeats([out, silent], 48000).beats, truth)).toBeGreaterThanOrEqual(0.95);
  });
});

describe('beat timing on the output', () => {
  it('maps song beats through trim and offset, inside the video', () => {
    const beats = [0.5, 1, 1.5, 2, 2.5, 3, 3.5];
    expect(beatsOnOutput(beats, { trimStartMs: 1000, trimEndMs: 3000, offsetMs: 2000 }, 3.6)).toEqual([2, 2.5, 3, 3.5]);
  });

  it('gives a phase and a pulse that peaks on each beat', () => {
    const beats = [1, 1.5, 2];
    expect(beatState(1, beats)).toEqual({ phase: 0, pulse: 1 });
    const mid = beatState(1.25, beats);
    expect(mid.phase).toBeCloseTo(0.5);
    expect(mid.pulse).toBeLessThan(0.2);
    // Outside the music: a steady 120 BPM grid keeps effects moving.
    expect(beatState(10, beats).phase).toBeCloseTo(0);
    expect(beatState(10.25, beats).phase).toBeCloseTo(0.5);
    expect(beatState(0.75, []).phase).toBeCloseTo(0.5);
  });

  it('moves slow motion onto beats, within reach', () => {
    const grid = Array.from({ length: 30 }, (_, i) => i * 0.5);
    // Start 2.1 → beat at 2.0. In the output the 4 s of 0.5× segment lasts 8 s: ends at 10.0, a beat.
    expect(snapSlowMotion({ startS: 2.1, endS: 6, speed: 0.5 }, grid, 0, 8)).toEqual({ startS: 2, endS: 6 });
    // With a 1.3 s intro the take starts later in the output: the start lands on the 3.5 s beat.
    const snapped = snapSlowMotion({ startS: 2.1, endS: 6, speed: 0.5 }, grid, 1.3, 8);
    expect(snapped.startS).toBeCloseTo(2.2);
    const endOut = 1.3 + snapped.startS + (snapped.endS - snapped.startS) / 0.5;
    expect(Math.abs(endOut / 0.5 - Math.round(endOut / 0.5))).toBeLessThan(1e-6);
    // Nothing within reach: unchanged.
    expect(snapSlowMotion({ startS: 2, endS: 6, speed: 0.5 }, [20], 0, 8)).toEqual({ startS: 2, endS: 6 });
  });
});
