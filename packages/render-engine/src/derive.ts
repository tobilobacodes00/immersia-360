import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
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
