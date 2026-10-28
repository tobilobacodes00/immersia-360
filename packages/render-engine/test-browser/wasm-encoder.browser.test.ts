import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import webBundle from 'h264-mp4-encoder/embuild/dist/h264-mp4-encoder.web.js?raw';
import glue from '../src/wasm/h264-glue.js?raw';
import { render, type RenderJob } from '../src/render';
import { configureWasmEncoder } from '../src/wasm/wasm-h264';
import { H, W, decodeOutput, makeClip } from './fixtures';

/**
 * The `wasm` rung in real Chrome: the same render, with the WebAssembly encoder in place of
 * WebCodecs'. The output is judged by what a viewer's decoder makes of it, not by looking inside.
 * The encoder's worker script is built here the way scripts/h264-worker.mjs builds the served one:
 * the encoder's web bundle, then our glue.
 */
const SRC_FPS = 30;
const SRC_FRAMES = 60;
const TARGET_BITRATE = 6_000_000;

const job = (take: Blob, patch: Partial<RenderJob> = {}): RenderJob => ({
  take,
  output: { width: W, height: H, fps: 30, bitrate: TARGET_BITRATE },
  slowMotion: { enabled: false, startS: 0, endS: 0, speed: 1 },
  reverse: 'none',
  ...patch,
});

describe('wasm rung: the WebAssembly H.264 encoder', () => {
  let clip: Blob;
  let scriptUrl: string;
  const useRealWorker = () => configureWasmEncoder({ createWorker: () => new Worker(scriptUrl) });

  beforeAll(async () => {
    clip = await makeClip(SRC_FRAMES, SRC_FPS);
    const script = `${webBundle.replace(/\/\/# sourceMappingURL=.*$/m, '')}\n;\n${glue}`;
    scriptUrl = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    useRealWorker();
  });

  afterEach(useRealWorker);

  it('renders every frame, in order, through the same compositor', async () => {
    const result = await render(job(clip), { encoder: 'wasm' });
    expect(result.frames).toBe(SRC_FRAMES);
    expect([result.width, result.height]).toEqual([W, H]);
    const out = await decodeOutput(result.mp4);
    expect(out.frames).toHaveLength(SRC_FRAMES);
    expect(out.frames.map((f) => f.index)).toEqual(Array.from({ length: SRC_FRAMES }, (_, i) => i));
    expect(out.fps).toBeCloseTo(30, 0);
  }, 120_000);

  it('writes a real key frame first and P-frames after (not "every frame is a sync sample")', async () => {
    const { mp4 } = await render(job(clip), { encoder: 'wasm' });
    const input = new Input({ source: new BlobSource(mp4), formats: ALL_FORMATS });
    const track = (await input.getPrimaryVideoTrack())!;
    const types: string[] = [];
    for await (const packet of new EncodedPacketSink(track).packets()) types.push(packet.type);
    expect(types).toHaveLength(SRC_FRAMES);
    expect(types[0]).toBe('key');
    expect(types.filter((t) => t === 'key').length).toBeLessThan(SRC_FRAMES / 4);
    // The level states what a 640×480 picture at 30 fps needs (3.0) or more.
    const config = (await track.getDecoderConfig())!;
    expect(config.codec).toMatch(/^avc1\.[0-9a-f]{6}$/);
    expect(parseInt(config.codec.slice(-2), 16)).toBeGreaterThanOrEqual(30);
    input.dispose();
  }, 120_000);

  it('adds the AAC soundtrack like the other rungs, and stays near its bitrate', async () => {
    const sampleRate = 48_000;
    const tone = new Float32Array(sampleRate * 2).map((_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    const result = await render(job(clip, { audio: { sampleRate, channels: [tone, tone.slice()] } }), {
      encoder: 'wasm',
    });
    const out = await decodeOutput(result.mp4);
    expect(out.hasAudio).toBe(true);
    expect(out.durationS).toBeCloseTo(2, 1);
    expect(result.mp4.size).toBeLessThan((TARGET_BITRATE / 8) * 2 * 3);
  }, 120_000);

  it('renders slow motion and intro cards the same way', async () => {
    const card = new OffscreenCanvas(W, H);
    const ctx = card.getContext('2d')!;
    ctx.fillStyle = '#2b3fe6';
    ctx.fillRect(0, 0, W, H);
    const result = await render(
      job(clip, {
        slowMotion: { enabled: true, startS: 0.5, endS: 1.5, speed: 0.5 },
        intro: { kind: 'still', image: card.transferToImageBitmap(), seconds: 1 },
      }),
      { encoder: 'wasm' },
    );
    // 1 s intro + (0.5 s + 1 s slowed to 2 s + 0.5 s) of video.
    expect(result.frames).toBe(30 + 90);
    expect(result.interpolatedFrames).toBeGreaterThan(5);
    const out = await decodeOutput(result.mp4);
    expect(out.frames).toHaveLength(result.frames);
    expect(out.frames[30]!.index).toBe(0);
  }, 120_000);

  it('reports a worker that cannot start as a missing encoder, so the ladder moves on', async () => {
    configureWasmEncoder({
      createWorker: () => {
        throw new Error('blocked');
      },
    });
    await expect(render(job(clip), { encoder: 'wasm' })).rejects.toMatchObject({ code: 'unsupported_encoder' });
  });
});
