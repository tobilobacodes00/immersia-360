import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import type { MaskSource, PersonMask } from '../src/background-math';
import { render, type RenderJob } from '../src/render';
import { H, W, decodeOutput, makeClip } from './fixtures';

/**
 * Background replacement in the render worker's pipeline (CAP-10): a real clip through render() and the H.264
 * encoder, with a STUB segmenter (a fixed disc where the "guest" is), so no model is needed. What is checked
 * is the wiring: the segmenter sees each frame as composed (slow-motion in-betweens too), the background goes
 * behind it, cards are left alone, video backgrounds loop in step, and a segmenter that will not start
 * costs the guest nothing but the replacement.
 */
const SRC_FPS = 30;
// One second of footage: the stage costs real time per frame on a software GPU (CI), and every frame is checked.
const SRC_FRAMES = 30;

const job = (take: Blob, patch: Partial<RenderJob> = {}): RenderJob => ({
  take,
  output: { width: W, height: H, fps: 30, bitrate: 6_000_000 },
  slowMotion: { enabled: false, startS: 0, endS: 0, speed: 1 },
  reverse: 'none',
  ...patch,
});

/** A guest-shaped disc at (0.5, 0.625) of the frame, 0.2 of its height in radius, like the clip's panning band. */
function discMask(width: number, height: number): PersonMask {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const dx = ((x + 0.5) / width - 0.5) * (width / height);
      const dy = (y + 0.5) / height - 0.625;
      if (Math.hypot(dx, dy) <= 0.2) data[y * width + x] = 1;
    }
  return { data, width, height };
}

function stubSegmenter() {
  const calls: { ts: number; width: number; height: number }[] = [];
  const state = { closed: 0, opened: 0 };
  const open = async (): Promise<MaskSource> => {
    state.opened++;
    return {
      async mask(frame, ts) {
        const f = frame as ImageData;
        calls.push({ ts, width: f.width, height: f.height });
        return discMask(f.width, f.height);
      },
      close: () => void state.closed++,
    };
  };
  return { open, calls, state };
}

/** Colours of chosen pixels in every frame of an MP4. */
async function pixelsPerFrame(mp4: Blob, points: readonly (readonly [number, number])[]) {
  const input = new Input({ source: new BlobSource(mp4), formats: ALL_FORMATS });
  const sink = new VideoSampleSink((await input.getPrimaryVideoTrack())!);
  const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
  const frames: [number, number, number][][] = [];
  for await (const s of sink.samples()) {
    s.draw(ctx, 0, 0, W, H);
    s.close();
    frames.push(
      points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data.subarray(0, 3)) as [number, number, number]),
    );
  }
  input.dispose();
  return frames;
}

const isGreen = ([r = 0, g = 0, b = 0]: readonly number[]) => r < 50 && g > 200 && b < 50;
const CORNER = [12, 12] as const;
const GUEST = [W / 2, Math.round(H * 0.625)] as const;

describe('background replacement in the render pipeline (CAP-10)', () => {
  let clip: Blob;
  const getClip = async () => (clip ??= await makeClip(SRC_FRAMES, SRC_FPS));

  it('puts a colour behind the guest on every frame, and closes the segmenter when done', async () => {
    const stub = stubSegmenter();
    const result = await render(job(await getClip(), { background: { kind: 'color', color: '#00ff00' } }), {
      segmenter: stub.open,
    });
    expect(result.background).toBe('applied');
    expect(result.frames).toBe(SRC_FRAMES);
    const frames = await pixelsPerFrame(result.mp4, [CORNER, GUEST]);
    expect(frames).toHaveLength(SRC_FRAMES);
    frames.forEach((f, i) => {
      expect(isGreen(f[0]!), `frame ${i} corner ${f[0]}`).toBe(true);
      // The guest (the clip's own picture inside the disc) is still there: not the background colour.
      expect(isGreen(f[1]!), `frame ${i} guest ${f[1]}`).toBe(false);
    });
    expect(stub.state).toEqual({ opened: 1, closed: 1 });
  });

  it('segments each frame as it is shown, with a small copy: slow-motion in-betweens as well as real frames', async () => {
    const stub = stubSegmenter();
    const patch = {
      slowMotion: { enabled: true, startS: 0.3, endS: 0.6, speed: 0.25 },
      background: { kind: 'blur' as const },
    };
    const result = await render(job(await getClip(), patch), { segmenter: stub.open });
    expect(result.interpolatedFrames).toBeGreaterThan(20);
    // One look at the person per output frame, not one per source frame.
    expect(stub.calls).toHaveLength(result.frames);
    for (const c of stub.calls) {
      expect(Math.max(c.width, c.height)).toBeLessThanOrEqual(256); // the model works at 256: never a full-size frame
      expect(c.width / c.height).toBeCloseTo(W / H, 1);
    }
    // Timestamps rise, as a video-mode segmenter needs.
    for (let i = 1; i < stub.calls.length; i++) expect(stub.calls[i]!.ts).toBeGreaterThan(stub.calls[i - 1]!.ts);
    expect(result.background).toBe('applied');
  });

  it('a video background plays in step with the take and starts over when it is shorter', async () => {
    const bg = await makeClip(12, SRC_FPS); // 0.4 s behind a 1 s take: it runs two and a half times
    const stub = stubSegmenter();
    const result = await render(job(await getClip(), { background: { kind: 'video', file: bg } }), {
      segmenter: stub.open,
    });
    expect(result.background).toBe('applied');
    const out = await decodeOutput(result.mp4);
    // The bars at the top of each frame carry its index. Outside the guest they are the BACKGROUND clip's, which
    // counts 0..11 and starts over; the take's own bars (0..29) are replaced.
    expect(out.frames.map((f) => f.index)).toEqual(Array.from({ length: SRC_FRAMES }, (_, i) => i % 12));
  });

  it('leaves intro and outro clips alone: only the footage is cut out', async () => {
    const card = await makeClip(10, SRC_FPS);
    const stub = stubSegmenter();
    const result = await render(
      job(await getClip(), {
        background: { kind: 'color', color: '#00ff00' },
        intro: { kind: 'clip', file: card, maxSeconds: 10 / SRC_FPS },
        outro: { kind: 'clip', file: card, maxSeconds: 10 / SRC_FPS },
      }),
      { segmenter: stub.open },
    );
    const frames = await pixelsPerFrame(result.mp4, [CORNER]);
    expect(frames).toHaveLength(10 + SRC_FRAMES + 10);
    frames.forEach((f, i) => {
      const footage = i >= 10 && i < 10 + SRC_FRAMES;
      expect(isGreen(f[0]!), `frame ${i} corner ${f[0]} (${footage ? 'footage' : 'card'})`).toBe(footage);
    });
    expect(stub.calls).toHaveLength(SRC_FRAMES); // the cards were never segmented
  });

  it('a segmenter that cannot start does not cost the guest their video', async () => {
    const result = await render(job(await getClip(), { background: { kind: 'color', color: '#00ff00' } }), {
      segmenter: async () => {
        throw new Error('no model on this device');
      },
    });
    expect(result.background).toBe('unavailable');
    const out = await decodeOutput(result.mp4);
    // Rendered as filmed: every frame, intact.
    expect(out.frames.map((f) => f.index)).toEqual(Array.from({ length: SRC_FRAMES }, (_, i) => i));
  });

  it('a render that has no segmenter at all (e.g. a test or an old worker) renders as filmed', async () => {
    const result = await render(job(await getClip(), { background: { kind: 'blur' } }));
    expect(result.background).toBe('unavailable');
    expect(result.frames).toBe(SRC_FRAMES);
  });

  it('with no background the segmenter is never even opened, and the result says so', async () => {
    const stub = stubSegmenter();
    const result = await render(job(await getClip()), { segmenter: stub.open });
    expect(result.background).toBe('none');
    expect(stub.state.opened).toBe(0);
    const out = await decodeOutput(result.mp4);
    expect(out.frames.map((f) => f.index)).toEqual(Array.from({ length: SRC_FRAMES }, (_, i) => i));
  });
});
