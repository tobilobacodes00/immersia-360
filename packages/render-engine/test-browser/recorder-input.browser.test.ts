import { describe, expect, it } from 'vitest';
import { probeTake } from '../src/probe';
import { render, type RenderJob } from '../src/render';
import { H, W, drawTestFrame } from './fixtures';

/**
 * The renderer's real input is whatever MediaRecorder writes on the booth device, not a clean
 * encoder-made MP4. Record with every format the booth may pick (see RECORDING_MIME_CANDIDATES in
 * @immersia/capture) and render each, including a take cut short by a crash.
 */
const FORMATS = [
  'video/webm;codecs=h264',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/mp4;codecs=avc1.640028',
  'video/mp4',
];

/**
 * Record the test pattern for at least `minMs` and until `minChunks` chunks have arrived (busy CI
 * runners deliver frames and chunks slower than wall-clock time suggests); resolves with the chunks
 * as the booth stores them.
 */
async function record(mimeType: string, minMs: number, minChunks = 1, timesliceMs = 250): Promise<Blob[]> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  // Same drawing API as OffscreenCanvasRenderingContext2D for everything the fixture uses.
  const ctx = canvas.getContext('2d') as unknown as OffscreenCanvasRenderingContext2D;
  drawTestFrame(ctx, 0);
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  let i = 0;
  const timer = setInterval(() => drawTestFrame(ctx, ++i), 1000 / 30);
  recorder.start(timesliceMs);
  const started = performance.now();
  while (performance.now() - started < minMs || (chunks.length < minChunks && performance.now() - started < 10_000))
    await new Promise((r) => setTimeout(r, 100));
  const stopped = new Promise((r) => (recorder.onstop = r));
  recorder.stop();
  await stopped;
  clearInterval(timer);
  stream.getTracks().forEach((t) => t.stop());
  return chunks;
}

const job = (take: Blob): RenderJob => ({
  take,
  output: { width: 320, height: 240, fps: 30, bitrate: 2_000_000 },
  slowMotion: { enabled: false, startS: 0, endS: 0, speed: 1 },
  reverse: 'none',
});

describe('MediaRecorder takes render (CAP-1 → VID-8)', () => {
  for (const mime of FORMATS) {
    const supported = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime);

    it.skipIf(!supported)(`${mime}: a complete take decodes and renders`, async () => {
      const chunks = await record(mime, 1500, 4);
      const take = new Blob(chunks, { type: mime });
      const probe = await probeTake(take);
      probe.input.dispose();
      expect(probe.decodable, `${mime} → decoder config ${probe.decoderCodec}`).toBe(true);
      expect(probe.pts.length).toBeGreaterThan(5);
      const result = await render(job(take));
      // Every output frame of the take's real duration is rendered (30 fps output).
      expect(result.frames).toBeGreaterThanOrEqual(Math.floor(probe.durationS * 30) - 1);
    });

    // WebM is the crash-safe container: a take whose last chunks never reached storage must render.
    it.skipIf(!supported || !mime.startsWith('video/webm'))(
      `${mime}: a take cut short mid-recording still renders`,
      async () => {
        const chunks = await record(mime, 2000, 6);
        expect(chunks.length).toBeGreaterThanOrEqual(6);
        const take = new Blob(chunks.slice(0, -2), { type: mime });
        const probe = await probeTake(take);
        probe.input.dispose();
        expect(probe.decodable, `${mime} (truncated) → decoder config ${probe.decoderCodec}`).toBe(true);
        expect(probe.pts.length).toBeGreaterThan(3);
        const result = await render(job(take));
        expect(result.frames).toBeGreaterThanOrEqual(Math.floor(probe.durationS * 30) - 1);
      },
    );
  }
});
