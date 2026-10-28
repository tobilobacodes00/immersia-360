import { AudioSample, AudioSampleSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output } from 'mediabunny';
import { FrameSource, type FramePair } from './frame-source';
import { Compositor, type ReelLayer, type SourceGeometry } from './gl/compositor';
import { kenBurns, planFrames, sourceRefs, type LayerAt, type ReelPlan } from './montage-plan';
import { probeTake, type TakeProbe } from './probe';
import { RenderError, ensureAac } from './render';

/**
 * The highlight reel's renderer (LIV-14): the same decode → WebGL2 compositor → WebCodecs H.264 → MP4
 * pipeline as a guest's video, over a timeline of many sources (`planReel`). Runs in the render worker.
 *
 * Footage plays at normal speed and in order, one decoder per clip, opened when the clip first appears and
 * closed when it has played out, so at most two are alive (a cross-fade) however long the reel is. Pictures
 * are decoded the same way, one at a time. Nothing is graded: the clips already carry the event's look.
 */

/** One source of the reel. Both kinds are blobs, decoded lazily where the render runs. */
export interface MontageFile {
  kind: 'video' | 'still';
  file: Blob;
}

export interface MontageJob {
  plan: ReelPlan;
  /** Indexed like the clips given to `planReel`. */
  clips: MontageFile[];
  /** The opening and closing cards, already drawn at the output size (needed when the plan has them). */
  intro?: ImageBitmap | null;
  end?: ImageBitmap | null;
  output: { width: number; height: number; fps: number; bitrate: number };
  /** Pre-mixed soundtrack covering the whole reel (planar float32). */
  audio?: { sampleRate: number; channels: Float32Array[] } | null;
}

export interface MontageResult {
  mp4: Blob;
  durationS: number;
  width: number;
  height: number;
  frames: number;
  renderMs: number;
  clips: number;
}

/** H.264 needs even dimensions. */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** One video clip's footage, in order: a frame for each output frame it is on screen. */
class ClipPlayer {
  private constructor(
    private readonly probe: TakeProbe,
    private readonly source: FrameSource,
    private readonly pairs: AsyncGenerator<FramePair>,
  ) {}

  /** `sourceTimes`: for each frame the clip is on screen, the time in the file to show (seconds from its first frame). */
  static async open(file: Blob, sourceTimes: number[], signal?: AbortSignal): Promise<ClipPlayer> {
    const probe = await probeTake(file);
    if (!probe.decodable) {
      probe.input.dispose();
      throw new RenderError('undecodable', `This browser can't decode ${probe.codec ?? 'one of the reel’s videos'}`);
    }
    const source = new FrameSource(probe);
    return new ClipPlayer(probe, source, source.pairs(sourceRefs(sourceTimes, probe.pts), signal));
  }

  /** The next frame (the caller closes it) with the geometry to frame it by. */
  async next(): Promise<{ frame: VideoFrame; geo: SourceGeometry }> {
    const step = await this.pairs.next();
    if (step.done) throw new RenderError('failed', 'A clip ran out of frames');
    const { width, height, rotation } = this.probe;
    return { frame: step.value.a.toVideoFrame(), geo: { width, height, rotation } };
  }

  async dispose() {
    await this.pairs.return(undefined).catch(() => undefined);
    this.source.dispose();
    this.probe.input.dispose();
  }
}

export async function renderMontage(
  job: MontageJob,
  opts: {
    onProgress?: (p: number) => void;
    signal?: AbortSignal;
    /** Awaited before the render starts and after every frame: a pause hook (as for `render`). */
    gate?: () => Promise<void>;
  } = {},
): Promise<MontageResult> {
  const { signal, onProgress, gate } = opts;
  const check = () => {
    if (signal?.aborted) throw new RenderError('cancelled', 'Render cancelled');
  };
  await gate?.();
  check();
  const started = performance.now();
  let pausedMs = 0;
  const pause = async () => {
    if (!gate) return;
    const t0 = performance.now();
    await gate();
    pausedMs += performance.now() - t0;
  };

  const { plan } = job;
  const width = even(job.output.width);
  const height = even(job.output.height);
  const fps = job.output.fps;
  const total = plan.frames;
  if (total <= 0) throw new RenderError('failed', 'The reel has nothing to show');
  for (const entry of plan.entries) {
    if (entry.role === 'intro' && !job.intro) throw new RenderError('failed', 'The reel’s opening card is missing');
    if (entry.role === 'end' && !job.end) throw new RenderError('failed', 'The reel’s closing card is missing');
    if (entry.role === 'clip' && !job.clips[entry.clip!])
      throw new RenderError('failed', 'A clip of the reel is missing');
  }

  // Which frames each entry is on screen for, and the source times they ask of it, in order.
  const timeline = planFrames(plan, fps);
  const spans = new Map<number, { last: number; times: number[] }>();
  timeline.forEach((frame, n) => {
    for (const layer of frame.layers) {
      const span = spans.get(layer.entry) ?? { last: n, times: [] };
      span.last = n;
      span.times.push(layer.sourceS);
      spans.set(layer.entry, span);
    }
  });

  let compositor: Compositor;
  try {
    compositor = new Compositor(new OffscreenCanvas(width, height), width, height);
  } catch (err) {
    throw new RenderError('gpu', err instanceof Error ? err.message : String(err));
  }
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const video = new CanvasSource(compositor.canvas, {
    codec: 'avc',
    bitrate: job.output.bitrate,
    keyFrameInterval: 1,
    latencyMode: 'quality',
  });
  output.addVideoTrack(video, { frameRate: fps });
  let audioSource: AudioSampleSource | null = null;
  if (job.audio && job.audio.channels.length) {
    await ensureAac();
    audioSource = new AudioSampleSource({ codec: 'aac', bitrate: 128_000 });
    output.addAudioTrack(audioSource);
  }
  await output.start();

  let written = 0;
  let lastProgress = 0;
  // Watchdog: an encoder that stops accepting frames is reported, not waited on forever.
  const add = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new RenderError('encoder_stall', 'The video encoder stopped responding')),
        30_000,
      );
    });
    try {
      await Promise.race([video.add(written / fps, 1 / fps), timeout]);
    } finally {
      clearTimeout(timer);
    }
    written++;
    const p = written / total;
    if (p - lastProgress >= 0.01 || written === total) {
      lastProgress = p;
      onProgress?.(p);
    }
    await pause();
  };

  const players = new Map<number, ClipPlayer>();
  const pictures = new Map<number, ImageBitmap>();
  const release = async (index: number) => {
    const player = players.get(index);
    players.delete(index);
    await player?.dispose();
    pictures.get(index)?.close();
    pictures.delete(index);
  };

  /** One layer of the frame being drawn. A video frame it opens is closed by `closers` once the frame is composed. */
  const layerFor = async (layer: LayerAt, closers: (() => void)[]): Promise<ReelLayer> => {
    const entry = plan.entries[layer.entry]!;
    if (entry.role !== 'clip') {
      const card = (entry.role === 'intro' ? job.intro : job.end)!;
      return { source: card, geo: { width: card.width, height: card.height, rotation: 0 } };
    }
    const file = job.clips[entry.clip!]!;
    if (file.kind === 'still') {
      let image = pictures.get(layer.entry);
      if (!image) {
        image = await createImageBitmap(file.file).catch((err: unknown) => {
          throw new RenderError('failed', err instanceof Error ? err.message : 'A picture could not be decoded');
        });
        pictures.set(layer.entry, image);
      }
      const move = kenBurns(layer.progress, {
        imageW: image.width,
        imageH: image.height,
        outW: width,
        outH: height,
        seq: entry.seq,
      });
      return {
        source: image,
        geo: { width: image.width, height: image.height, rotation: 0 },
        zoom: move.zoom,
        pan: [move.panX, move.panY],
      };
    }
    let player = players.get(layer.entry);
    if (!player) {
      player = await ClipPlayer.open(file.file, spans.get(layer.entry)!.times, signal);
      players.set(layer.entry, player);
    }
    const { frame, geo } = await player.next();
    closers.push(() => frame.close());
    return { source: frame, geo };
  };

  try {
    for (let n = 0; n < total; n++) {
      check();
      const { layers, mix } = timeline[n]!;
      const closers: (() => void)[] = [];
      try {
        // In order: the earlier layer of a cross-fade first, so a clip's frames are always taken in sequence.
        const first = await layerFor(layers[0]!, closers);
        const second = layers[1] ? await layerFor(layers[1], closers) : null;
        compositor.composeLayers(first, second, mix);
      } finally {
        for (const close of closers) close();
      }
      compositor.finish(false);
      await add();
      for (const [index, span] of spans) if (span.last === n) await release(index);
    }
    check();
    if (audioSource && job.audio) {
      const { sampleRate, channels } = job.audio;
      const length = channels[0]!.length;
      const planar = new Float32Array(length * channels.length);
      channels.forEach((ch, i) => planar.set(ch.subarray(0, length), i * length));
      const sample = new AudioSample({
        data: planar,
        format: 'f32-planar',
        numberOfChannels: channels.length,
        sampleRate,
        timestamp: 0,
      });
      await audioSource.add(sample);
      sample.close();
    }
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => undefined);
    // A cancelled render ends its clips' frame streams early: that, not what it looks like, is the cause.
    if (signal?.aborted) throw new RenderError('cancelled', 'Render cancelled');
    if (err instanceof RenderError) throw err;
    throw new RenderError('failed', err instanceof Error ? err.message : String(err));
  } finally {
    for (const index of [...players.keys(), ...pictures.keys()]) await release(index);
    compositor.dispose();
  }

  return {
    mp4: new Blob([target.buffer!], { type: 'video/mp4' }),
    durationS: written / fps,
    width,
    height,
    frames: written,
    renderMs: Math.round(performance.now() - started - pausedMs),
    clips: plan.clips,
  };
}
