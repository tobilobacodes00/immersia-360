import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import { renderMontage, type MontageFile, type MontageJob, type MontageResult } from '../src/montage';
import { planFrames, planReel, sourceRefs, type ReelClip, type ReelPlan } from '../src/montage-plan';
import { uniformPts } from '../src/timeline';
import { H, W, makeClip, readIndex } from './fixtures';

/**
 * The highlight reel (LIV-14) rendered for real, in Chrome: a few seconds of fixture clips, a photo strip
 * and two cards through the montage renderer. The fixture clips carry each frame's index in black and
 * white bars, so every output frame can be checked against the plan.
 *
 * Every test that renders has 300 s instead of the project's 120: a render of several seconds is slow here (the
 * compositor runs on software WebGL, the decoders and the encoder on the CPU) and CI runs the other browser test
 * files beside it. The first test of this file once ran out of the 120 s, fixtures included.
 */
const FPS = 30;
const CLIP_FRAMES = 90; // 3 s
const BLUE: [number, number, number] = [43, 63, 230];
const WHITE: [number, number, number] = [255, 255, 255];

const card = (rgb: [number, number, number]) => {
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `rgb(${rgb.join(',')})`;
  ctx.fillRect(0, 0, W, H);
  return c.transferToImageBitmap();
};

/** A tall photo strip: red on top, green below (a quarter of it fills the frame, so its pan shows). */
async function strip(): Promise<Blob> {
  const c = new OffscreenCanvas(200, 600);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d02020';
  ctx.fillRect(0, 0, 200, 300);
  ctx.fillStyle = '#20d020';
  ctx.fillRect(0, 300, 200, 300);
  return c.convertToBlob({ type: 'image/png' });
}

interface Decoded {
  index: number | null;
  px: number[][];
}

/** Every frame of an MP4: its bar index (when the bars are clean) and the RGB at the given points. */
async function decode(mp4: Blob, points: [number, number][]): Promise<Decoded[]> {
  const input = new Input({ source: new BlobSource(mp4), formats: ALL_FORMATS });
  try {
    const sink = new VideoSampleSink((await input.getPrimaryVideoTrack())!);
    const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
    const frames: Decoded[] = [];
    for await (const s of sink.samples()) {
      s.draw(ctx, 0, 0, W, H);
      s.close();
      frames.push({
        index: readIndex(ctx),
        px: points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]),
      });
    }
    return frames;
  } finally {
    input.dispose();
  }
}

const video = (id: string, at: number): ReelClip => ({
  id,
  kind: 'video',
  usable: { fromS: 0, toS: 3 },
  weight: 0.5,
  capturedAtMs: at,
});

describe('highlight reel montage (LIV-14)', () => {
  let clipA: Blob;
  let clipB: Blob;
  let still: Blob;
  const files = async (): Promise<{ strip: MontageFile; a: MontageFile; b: MontageFile }> => {
    clipA ??= await makeClip(CLIP_FRAMES, FPS);
    clipB ??= await makeClip(CLIP_FRAMES, FPS);
    still ??= await strip();
    return {
      strip: { kind: 'still', file: still },
      a: { kind: 'video', file: clipA },
      b: { kind: 'video', file: clipB },
    };
  };
  const job = async (plan: ReelPlan, clips: MontageFile[], patch: Partial<MontageJob> = {}): Promise<MontageJob> => ({
    plan,
    clips,
    intro: card(BLUE),
    end: card(WHITE),
    output: { width: W, height: H, fps: FPS, bitrate: 6_000_000 },
    ...patch,
  });
  /** A strip and two videos: the strip ranks first, so it opens the reel. */
  const mixed = (style: 'cut' | 'crossfade') =>
    planReel([{ id: 'strip', kind: 'still', weight: 1, capturedAtMs: 1 }, video('a', 2), video('b', 3)], {
      targetS: 9,
      fps: FPS,
      introS: 1,
      endS: 1,
      style,
      beats: [],
    });
  const videos = (style: 'cut' | 'crossfade') =>
    planReel([video('a', 1), video('b', 2)], { targetS: 8, fps: FPS, introS: 1, endS: 1, style, beats: [] });

  /**
   * The cut reel (a strip and two videos, with a soundtrack): two tests judge it, so it is rendered once, by
   * whichever asks first. Progress is logged so a slow CI run can be told from a stuck one.
   */
  let cutReel: Promise<{ plan: ReelPlan; result: MontageResult }> | null = null;
  const renderCutReel = () =>
    (cutReel ??= (async () => {
      const t0 = performance.now();
      const secs = () => ((performance.now() - t0) / 1000).toFixed(1);
      const f = await files();
      console.info(`[montage] fixtures ready after ${secs()} s`);
      const plan = mixed('cut');
      const sampleRate = 48_000;
      const tone = new Float32Array(sampleRate * Math.ceil(plan.totalS)).map(
        (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / sampleRate),
      );
      let logged = 0;
      const result = await renderMontage(
        await job(plan, [f.strip, f.a, f.b], { audio: { sampleRate, channels: [tone, tone.slice()] } }),
        {
          onProgress: (v) => {
            if (v >= logged + 0.25 || v === 1) {
              logged = v;
              console.info(`[montage] cut reel ${Math.round(v * 100)}% after ${secs()} s`);
            }
          },
        },
      );
      return { plan, result };
    })());

  it('cuts between clips: every video frame is the source frame the plan asks for, in order', async () => {
    const { plan: p, result } = await renderCutReel();
    expect(p.clips).toBe(3);
    expect(result.frames).toBe(p.frames);
    expect(result.durationS).toBeCloseTo(p.totalS, 1);
    expect(result.clips).toBe(3);

    const out = await decode(result.mp4, []);
    expect(out).toHaveLength(p.frames);
    // The fixture's frames sit at uniform times: the frame the plan means is the nearest one (±1 where
    // the plan lands exactly between two).
    const pts = uniformPts(CLIP_FRAMES, FPS);
    let checked = 0;
    planFrames(p, FPS).forEach((frame, n) => {
      const entry = p.entries[frame.layers[0]!.entry]!;
      if (entry.role !== 'clip' || entry.kind !== 'video') return;
      const wanted = sourceRefs([frame.layers[0]!.sourceS], pts)[0]!.a;
      expect(Math.abs(out[n]!.index! - wanted), `frame ${n}`).toBeLessThanOrEqual(1);
      checked++;
    });
    // Two videos, each on screen for at least the shortest a clip may be.
    expect(checked).toBeGreaterThanOrEqual(2 * 1.6 * FPS - 2);
    // The soundtrack came along.
    const input = new Input({ source: new BlobSource(result.mp4), formats: ALL_FORMATS });
    expect(Boolean(await input.getPrimaryAudioTrack())).toBe(true);
    input.dispose();
  }, 300_000);

  it('opens on the intro card, cross-fades into the first clip and closes on the end card', async () => {
    const f = await files();
    const p = videos('crossfade');
    const result = await renderMontage(await job(p, [f.a, f.b]));
    // Bottom-centre is the fixtures' plain grey (128); the intro is blue (43, 63, 230), the end card white.
    const out = await decode(result.mp4, [[W / 2, H - 12]]);
    expect(out).toHaveLength(p.frames);
    const px = (n: number) => out[n]!.px[0]!;
    expect(px(2)[2]).toBeGreaterThan(200);
    expect(px(out.length - 2)[0]).toBeGreaterThan(235);
    const fading = planFrames(p, FPS)
      .map((frame, n) => ({ n, layers: frame.layers.length, entry: frame.layers[0]!.entry }))
      .filter((frame) => frame.layers === 2 && frame.entry === 0);
    expect(fading.length).toBeGreaterThan(8);
    // Blue to grey: red climbs from the card's 43 towards 128, steadily.
    const reds = fading.map((frame) => px(frame.n)[0]!);
    expect(reds[0]!).toBeLessThan(reds.at(-1)!);
    expect(reds.some((r) => r > 60 && r < 115)).toBe(true);
    for (let i = 1; i < reds.length; i++) expect(reds[i]!).toBeGreaterThanOrEqual(reds[i - 1]! - 6);
  }, 300_000);

  it('pans a tall photo strip: the top of it first, the bottom of it last', async () => {
    const { plan: p, result } = await renderCutReel();
    const out = await decode(result.mp4, [[W / 2, H / 2]]);
    const own = planFrames(p, FPS).flatMap((frame, n) => {
      const entry = p.entries[frame.layers[0]!.entry]!;
      return entry.role === 'clip' && entry.kind === 'still' ? [n] : [];
    });
    expect(own.length).toBeGreaterThan(2.3 * FPS);
    const [r0, g0] = out[own[0]!]!.px[0]!;
    const [r1, g1] = out[own.at(-1)!]!.px[0]!;
    expect([r0! > 150, g0! < 100]).toEqual([true, true]); // red: the top of the strip
    expect([g1! > 150, r1! < 100]).toEqual([true, true]); // green: the bottom of it
  }, 300_000);

  it('reports progress, and refuses a plan whose cards are missing', async () => {
    const f = await files();
    const p = videos('cut');
    const progress: number[] = [];
    await renderMontage(await job(p, [f.a, f.b]), { onProgress: (v) => progress.push(v) });
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    await expect(renderMontage(await job(p, [f.a, f.b], { intro: null }))).rejects.toMatchObject({ code: 'failed' });
  }, 300_000);

  it('cancels promptly', async () => {
    const f = await files();
    const controller = new AbortController();
    const rendering = renderMontage(await job(videos('cut'), [f.a, f.b]), { signal: controller.signal });
    controller.abort();
    await expect(rendering).rejects.toMatchObject({ code: 'cancelled' });
  });
});
