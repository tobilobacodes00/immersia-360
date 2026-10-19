import type { VideoSample } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import { FrameSource } from '../src/frame-source';
import { probeTake } from '../src/probe';
import { buildSourceTimes, resolveFrames, type SlowMotion } from '../src/timeline';
import { H, W, makeClip, readIndex } from './fixtures';

/**
 * FrameSource must hand the compositor exactly the source frames the timeline asks for, in every
 * run direction: a frame off by one is invisible on a real frame but ruins an in-between one.
 */
const SRC_FPS = 30;
const SRC_FRAMES = 60;

async function servedFrames(slowMotion: SlowMotion, reverse: 'none' | 'boomerang' | 'reverse') {
  const probe = await probeTake(await makeClip(SRC_FRAMES, SRC_FPS));
  const refs = resolveFrames(
    buildSourceTimes({ durationS: probe.durationS, outputFps: SRC_FPS, slowMotion, reverse }),
    probe.pts,
  );
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const index = (s: VideoSample) => {
    s.draw(ctx, 0, 0, W, H);
    return readIndex(ctx);
  };
  const source = new FrameSource(probe);
  const mismatches: string[] = [];
  let pairs = 0;
  try {
    for await (const pair of source.pairs(refs)) {
      const ref = refs[pair.index]!;
      const a = index(pair.a);
      const b = pair.b ? index(pair.b) : null;
      if (a !== ref.a || b !== ref.b) mismatches.push(`out ${pair.index}: wanted ${ref.a}/${ref.b}, got ${a}/${b}`);
      pairs++;
    }
  } finally {
    source.dispose();
    probe.input.dispose();
  }
  return { mismatches, pairs, expected: refs.length };
}

const slow: SlowMotion = { enabled: true, startS: 0.5, endS: 1.5, speed: 0.25 };

describe('FrameSource serves the frames the timeline asks for', () => {
  it('forward, with a 0.25× slow segment (pairs of neighbours)', async () => {
    const r = await servedFrames(slow, 'none');
    expect(r.pairs).toBe(r.expected);
    expect(r.mismatches.slice(0, 10)).toEqual([]);
  });

  it('reverse and boomerang (frames served from the all-keyframe cache)', async () => {
    for (const reverse of ['reverse', 'boomerang'] as const) {
      const r = await servedFrames(slow, reverse);
      expect(r.pairs, reverse).toBe(r.expected);
      expect(r.mismatches.slice(0, 10), reverse).toEqual([]);
    }
  });
});
