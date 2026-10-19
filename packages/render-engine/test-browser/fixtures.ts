import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
} from 'mediabunny';

export const W = 640;
export const H = 480;
const BITS = 8;
const BAR_H = 120;
/** The background band below the index bars pans like a 360 platform's sweep. */
export const BAND = { top: 140, height: 300 };
export const PAN_PX_PER_FRAME = 12;
const PERIOD = 512;

/** A deterministic, periodic stripe texture (varied widths and tones), so panning has real detail. */
function stripeAt(x: number): string {
  const xm = ((x % PERIOD) + PERIOD) % PERIOD;
  const band = Math.floor(xm / 16);
  const v = 60 + ((band * 97) % 150);
  return `rgb(${v},${((v * 3) % 200) + 30},${255 - v})`;
}

/** Draw the panning band for a (possibly fractional) frame position. */
export function drawBand(ctx: OffscreenCanvasRenderingContext2D, position: number) {
  const offset = position * PAN_PX_PER_FRAME;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, BAND.top, W, BAND.height);
  ctx.clip();
  ctx.translate(-(offset % PERIOD), 0);
  for (let x = 0; x < W + PERIOD; x += 16) {
    ctx.fillStyle = stripeAt(x);
    ctx.fillRect(x, BAND.top, 16, BAND.height);
  }
  ctx.restore();
}

/** Frame `i`: its index as 8 black/white bars (MSB left) above a panning textured band. */
export function drawTestFrame(ctx: OffscreenCanvasRenderingContext2D, i: number) {
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, W, H);
  const bw = W / BITS;
  for (let b = 0; b < BITS; b++) {
    ctx.fillStyle = (i >> (BITS - 1 - b)) & 1 ? '#ffffff' : '#000000';
    ctx.fillRect(b * bw, 0, bw, BAR_H);
  }
  drawBand(ctx, i);
}

/** A constant-frame-rate H.264 MP4 of `count` test frames. */
export async function makeClip(count: number, fps: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new VideoSampleSource({ codec: 'avc', bitrate: 6_000_000, keyFrameInterval: 10 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  for (let i = 0; i < count; i++) {
    drawTestFrame(ctx, i);
    const sample = new VideoSample(canvas, { timestamp: i / fps, duration: 1 / fps });
    await source.add(sample);
    sample.close();
  }
  await output.finalize();
  return new Blob([target.buffer!], { type: 'video/mp4' });
}

/** Mean absolute RGB difference inside the band between two images of the band. */
export function bandError(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let p = 0; p < a.length; p += 4)
    sum += Math.abs(a[p]! - b[p]!) + Math.abs(a[p + 1]! - b[p + 1]!) + Math.abs(a[p + 2]! - b[p + 2]!);
  return sum / ((a.length / 4) * 3);
}

/** Ground truth and a cross-fade baseline for an in-between position, as band pixels. */
export function idealAndCrossfade(a: number, alpha: number) {
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const grab = () => ctx.getImageData(0, BAND.top, W, BAND.height).data;
  drawBand(ctx, a + alpha);
  const ideal = grab();
  drawBand(ctx, a);
  ctx.globalAlpha = alpha;
  drawBand(ctx, a + 1);
  ctx.globalAlpha = 1;
  const fade = grab();
  return { ideal, fade };
}

/** The frame index encoded in the bars, or null when the bars aren't clean black/white (a blend). */
export function readIndex(ctx: OffscreenCanvasRenderingContext2D): number | null {
  const bars: number[] = [];
  const bw = W / BITS;
  for (let b = 0; b < BITS; b++) {
    const d = ctx.getImageData(Math.round(b * bw + bw * 0.3), 30, Math.round(bw * 0.4), 60).data;
    let sum = 0;
    for (let p = 0; p < d.length; p += 4) sum += d[p]!;
    bars.push(sum / (d.length / 4));
  }
  const clean = bars.every((v) => v < 60 || v > 195);
  return clean ? bars.reduce((acc, v) => (acc << 1) | (v > 128 ? 1 : 0), 0) : null;
}

export interface DecodedFrame {
  index: number | null;
  /** The panning band's pixels (RGBA), at source scale. */
  band: Uint8ClampedArray;
}

export async function decodeOutput(
  mp4: Blob,
): Promise<{ frames: DecodedFrame[]; durationS: number; hasAudio: boolean; fps: number }> {
  const input = new Input({ source: new BlobSource(mp4), formats: ALL_FORMATS });
  const track = (await input.getPrimaryVideoTrack())!;
  const sink = new VideoSampleSink(track);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const frames: DecodedFrame[] = [];
  let last = 0;
  for await (const s of sink.samples()) {
    s.draw(ctx, 0, 0, W, H);
    last = s.timestamp + s.duration;
    s.close();
    frames.push({ index: readIndex(ctx), band: ctx.getImageData(0, BAND.top, W, BAND.height).data });
  }
  const hasAudio = Boolean(await input.getPrimaryAudioTrack());
  const stats = await track.computePacketStats();
  input.dispose();
  return { frames, durationS: last, hasAudio, fps: stats.averagePacketRate };
}
