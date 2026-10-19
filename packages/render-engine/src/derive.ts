import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
} from 'mediabunny';
import { messagingSize, videoBitrate } from './presets';

/**
 * Outputs derived from a finished render, made after it at low priority so the guest's QR and main
 * video never wait on them.
 */

/**
 * DL-8: the lighter copy for messaging apps: 720p-class at the Small preset, audio copied. A
 * transcode of the finished MP4 (decode, scale, encode), far cheaper than rendering twice.
 */
export async function messagingCopy(mp4: Blob, fps: number): Promise<Blob> {
  const input = new Input({ source: new BlobSource(mp4), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('The render has no video track');
    const size = messagingSize(await video.getSquarePixelWidth(), await video.getSquarePixelHeight());
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        width: size.width,
        height: size.height,
        fit: 'fill',
        codec: 'avc',
        bitrate: videoBitrate('small', size.width, size.height, fps),
        keyFrameInterval: 2,
      },
    });
    if (!conversion.isValid)
      throw new Error(`Cannot make the messaging copy: ${conversion.discardedTracks.map((t) => t.reason).join(', ')}`);
    await conversion.execute();
    return new Blob([target.buffer!], { type: 'video/mp4' });
  } finally {
    input.dispose();
  }
}

/** The share page's poster (shown before the video loads): one frame of the render, as a JPEG. */
export async function posterFrame(mp4: Blob, at = 0.4, quality = 0.82): Promise<Blob> {
  const input = new Input({ source: new BlobSource(mp4), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('The render has no video track');
    const duration = await input.computeDuration();
    const sink = new VideoSampleSink(video);
    const sample = (await sink.getSample(duration * at)) ?? (await sink.getSample(0));
    if (!sample) throw new Error('The render has no frames');
    try {
      const canvas = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
      sample.draw(canvas.getContext('2d')!, 0, 0);
      return await canvas.convertToBlob({ type: 'image/jpeg', quality });
    } finally {
      sample.close();
    }
  } finally {
    input.dispose();
  }
}

/**
 * PHO-2: a short MP4 from frames captured around shutter presses (the photo booth's motion buffer):
 * played straight through (short video) or forward then back (boomerang). Frames are drawn at the
 * first frame's size (even dimensions for H.264) and closed as they are encoded.
 */
export async function encodeClip(frames: ImageBitmap[], fps: number, opts: { pingPong?: boolean } = {}): Promise<Blob> {
  if (!frames.length) throw new Error('No frames to encode');
  const order = opts.pingPong && frames.length > 2 ? [...frames, ...frames.slice(1, -1).reverse()] : frames;
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const width = even(frames[0]!.width);
  const height = even(frames[0]!.height);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: videoBitrate('balanced', width, height, fps),
    keyFrameInterval: 1,
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  try {
    for (let i = 0; i < order.length; i++) {
      ctx.drawImage(order[i]!, 0, 0, width, height);
      await source.add(i / fps, 1 / fps);
    }
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => undefined);
    throw err;
  } finally {
    for (const f of frames) f.close();
  }
  return new Blob([target.buffer!], { type: 'video/mp4' });
}
