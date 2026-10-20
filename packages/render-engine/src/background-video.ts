import { VideoSampleSink, type VideoSample } from 'mediabunny';
import { loopTimes } from './background-math';
import type { SourceGeometry } from './gl/compositor';
import { probeTake, type TakeProbe } from './probe';

/**
 * A video used as a background (CAP-10), played in step with the take: output frame i shows the
 * background at i / fps, and when the background is shorter than the take it starts over, so it always
 * covers the take's whole length. Decoded with the same mediabunny path as the take itself.
 */
export class LoopingVideo {
  readonly geometry: SourceGeometry;
  private readonly frames: AsyncGenerator<VideoSample | null>;

  private constructor(
    private readonly probe: TakeProbe,
    fps: number,
    count: number,
  ) {
    this.geometry = { width: probe.width, height: probe.height, rotation: probe.rotation };
    this.frames = this.generate(fps, count);
  }

  /** Throws if the file cannot be read or this browser cannot decode it. */
  static async open(file: Blob, fps: number, count: number): Promise<LoopingVideo> {
    const probe = await probeTake(file);
    if (!probe.decodable) {
      probe.input.dispose();
      throw new Error(`This browser can't decode the background video (${probe.codec ?? 'unknown codec'})`);
    }
    return new LoopingVideo(probe, fps, count);
  }

  /**
   * The next frame, in output order, or null if the decoder had none for this instant (hold the last
   * one). The caller closes the sample.
   */
  async next(): Promise<VideoSample | null> {
    const step = await this.frames.next();
    return step.done ? null : step.value;
  }

  dispose() {
    void this.frames.return(undefined);
    this.probe.input.dispose();
  }

  private async *generate(fps: number, count: number): AsyncGenerator<VideoSample | null> {
    const { video, firstTimestamp, durationS } = this.probe;
    const sink = new VideoSampleSink(video);
    // One pass through the file per loop, so each packet is still decoded once (the timestamps ascend).
    const perLoop = Math.max(1, Math.round(durationS * fps));
    let produced = 0;
    while (produced < count) {
      const n = Math.min(perLoop, count - produced);
      const times = loopTimes(n, fps, durationS).map((t) => firstTimestamp + t);
      let yielded = 0;
      for await (const sample of sink.samplesAtTimestamps(times)) {
        yielded++;
        produced++;
        yield sample;
      }
      if (yielded === 0) return; // nothing decodable: stop rather than spin
    }
  }
}
