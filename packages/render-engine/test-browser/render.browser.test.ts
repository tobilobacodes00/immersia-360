import { describe, expect, it } from 'vitest';
import { render, type RenderJob } from '../src/render';
import { buildSourceTimes, resolveFrames, uniformPts } from '../src/timeline';
import { H, W, bandError, decodeOutput, idealAndCrossfade, makeClip } from './fixtures';

/**
 * Golden tests for the render engine, in a real browser (WebCodecs + WebGL2). The source clip
 * carries each frame's index as black/white bars, so every output frame can be checked against
 * the timeline exactly — slow motion, reverse and boomerang included.
 */
const SRC_FPS = 30;
const SRC_FRAMES = 60;

const job = (take: Blob, patch: Partial<RenderJob> = {}): RenderJob => ({
  take,
  output: { width: W, height: H, fps: 30, bitrate: 6_000_000 },
  slowMotion: { enabled: false, startS: 0, endS: 0, speed: 1 },
  reverse: 'none',
  ...patch,
});

function expected(patch: Partial<RenderJob>) {
  const j = job(new Blob(), patch);
  const times = buildSourceTimes({
    durationS: SRC_FRAMES / SRC_FPS,
    outputFps: 30,
    slowMotion: j.slowMotion,
    reverse: j.reverse,
  });
  return resolveFrames(times, uniformPts(SRC_FRAMES, SRC_FPS));
}

describe('render engine (VID-1, 2, 3, 8, 9)', () => {
  let clip: Blob;
  const getClip = async () => (clip ??= await makeClip(SRC_FRAMES, SRC_FPS));

  it('normal speed: every output frame is exactly its source frame', async () => {
    const result = await render(job(await getClip()));
    const out = await decodeOutput(result.mp4);
    expect(out.frames).toHaveLength(SRC_FRAMES);
    expect(out.frames.map((f) => f.index)).toEqual(Array.from({ length: SRC_FRAMES }, (_, i) => i));
    expect(result.interpolatedFrames).toBe(0);
  });

  it('VID-1: a 0.5× segment doubles its length; its real frames match the timeline', async () => {
    const patch = { slowMotion: { enabled: true, startS: 0.5, endS: 1.5, speed: 0.5 } };
    const result = await render(job(await getClip(), patch));
    const out = await decodeOutput(result.mp4);
    const exp = expected(patch);
    expect(out.frames).toHaveLength(exp.length);
    exp.forEach((e, i) => {
      if (e.b === null) expect(out.frames[i]!.index, `frame ${i}`).toBe(e.a);
    });
    expect(result.durationS).toBeCloseTo(3, 1);
  });

  it('VID-2: interpolated frames match the true in-between image far better than a cross-fade', async () => {
    // A panning background, like a 360 platform's sweep, slowed to 0.25×: 3 of every 4 output
    // frames fall between real frames and must be synthesised.
    const patch = { slowMotion: { enabled: true, startS: 0.5, endS: 1.5, speed: 0.25 } };
    const result = await render(job(await getClip(), patch));
    expect(result.interpolatedFrames).toBeGreaterThan(20);
    const out = await decodeOutput(result.mp4);
    const exp = expected(patch);
    // Every frame here went through two H.264 encodes (the source clip and the output), which costs
    // the real frames accuracy too. That floor, measured on the real frames in the same window, is
    // the codec's; what interpolation adds on top of it is what this test judges.
    let floor = 0;
    let floorN = 0;
    let interpError = 0;
    let fadeError = 0;
    let n = 0;
    const perFrame: { i: number; alpha: number; err: number }[] = [];
    exp.forEach((e, i) => {
      if (e.t < 0.6 || e.t > 1.4) return;
      if (e.b === null) {
        floor += bandError(out.frames[i]!.band, idealAndCrossfade(e.a, 0).ideal);
        floorN++;
        return;
      }
      const { ideal, fade } = idealAndCrossfade(e.a, e.alpha);
      const err = bandError(out.frames[i]!.band, ideal);
      interpError += err;
      fadeError += bandError(fade, ideal);
      perFrame.push({ i, alpha: e.alpha, err });
      n++;
    });
    floor /= floorN;
    interpError /= n;
    fadeError /= n;
    const worst = [...perFrame].sort((a, b) => b.err - a.err).slice(0, 4);
    console.warn(
      `[VID-2] mean error vs truth: real frames (codec floor) ${floor.toFixed(2)}, interpolated ${interpError.toFixed(2)}, ` +
        `cross-fade ${fadeError.toFixed(2)}; worst ${worst.map((w) => `#${w.i}@${w.alpha.toFixed(2)}=${w.err.toFixed(1)}`).join(' ')}`,
    );
    expect(n).toBeGreaterThan(20);
    expect(floorN).toBeGreaterThan(5);
    // Better than blending outright, and what interpolation adds over the codec floor is a fraction
    // of what a cross-fade gets wrong (the pure interpolator, without the codec, is held to a
    // tighter bar in compositor.browser.test.ts).
    expect(interpError).toBeLessThan(fadeError);
    expect(interpError - floor).toBeLessThan(fadeError * 0.5);
  });

  it('VID-3 reverse: plays forward then back to the first frame', async () => {
    const result = await render(job(await getClip(), { reverse: 'reverse' }));
    const idx = (await decodeOutput(result.mp4)).frames.map((f) => f.index);
    expect(idx).toEqual([...Array.from({ length: 60 }, (_, i) => i), ...Array.from({ length: 59 }, (_, i) => 58 - i)]);
  });

  it('VID-3 boomerang: forward, back through the slow segment, forward to the end', async () => {
    const patch = { reverse: 'boomerang' as const, slowMotion: { enabled: true, startS: 0.5, endS: 1, speed: 1 } };
    const result = await render(job(await getClip(), patch));
    const idx = (await decodeOutput(result.mp4)).frames.map((f) => f.index);
    const exp = expected(patch).map((e) => e.a);
    expect(idx).toEqual(exp);
  });

  it('VID-6/8: adds an AAC soundtrack and writes a playable MP4 with exact frame timing', async () => {
    const sampleRate = 48_000;
    const seconds = 2;
    const tone = new Float32Array(sampleRate * seconds).map(
      (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / sampleRate),
    );
    const result = await render(job(await getClip(), { audio: { sampleRate, channels: [tone, tone.slice()] } }));
    const out = await decodeOutput(result.mp4);
    expect(out.hasAudio).toBe(true);
    expect(out.fps).toBeCloseTo(30, 0);
    expect(out.durationS).toBeCloseTo(2, 1);
    // Fast start: the moov atom comes before the media data, so phones start playing at once.
    const head = new TextDecoder().decode(new Uint8Array(await result.mp4.slice(0, 4096).arrayBuffer()));
    expect(head.indexOf('moov')).toBeGreaterThan(-1);
  });

  it('intro and end cards are added at the requested length', async () => {
    const card = (color: string) => {
      const c = new OffscreenCanvas(W, H);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, H);
      return c.transferToImageBitmap();
    };
    const result = await render(
      job(await getClip(), {
        intro: { kind: 'still', image: card('#2b3fe6'), seconds: 1 },
        endCard: { kind: 'still', image: card('#ffffff'), seconds: 2 },
      }),
    );
    expect(result.frames).toBe(30 + SRC_FRAMES + 60);
    const out = await decodeOutput(result.mp4);
    expect(out.frames[30]!.index).toBe(0);
    expect(out.frames.at(-61)!.index).toBe(SRC_FRAMES - 1);
  });

  it('parks between frames while paused, then finishes (VID-9 yields to capture)', async () => {
    let calls = 0;
    let parked = false;
    let resume = () => {};
    const gate = () => {
      // Called once before the render and once after every frame: park after a few frames.
      if (++calls !== 10) return Promise.resolve();
      parked = true;
      return new Promise<void>((go) => (resume = go));
    };
    const progress: number[] = [];
    const done = render(job(await getClip()), { gate, onProgress: (p) => progress.push(p) });
    await expect.poll(() => parked).toBe(true);
    const reported = progress.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(progress).toHaveLength(reported);
    resume();
    const result = await done;
    expect(result.frames).toBe(SRC_FRAMES);
    expect(progress.at(-1)).toBe(1);
  });

  it('cancels promptly', async () => {
    const controller = new AbortController();
    const p = render(job(await getClip(), { reverse: 'reverse' }), { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  });
});
