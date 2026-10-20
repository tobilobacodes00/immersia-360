import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  canEncodeAudio,
} from 'mediabunny';
import { LOOK_FRAG, findEffect, findLook, lookUniforms, type ColorMode } from '@immersia/effects';
import type { MaskSource } from './background-math';
import { BackgroundRun, type BackgroundOutcome } from './background-run';
import { beatState } from './beats';
import { FrameSource } from './frame-source';
import { Compositor } from './gl/compositor';
import { probeTake, type TakeProbe } from './probe';
import { buildSourceTimes, resolveFrames, type SlowMotion } from './timeline';

/** A still card (intro/outro, QR end card), already rendered to a bitmap. */
export interface StillCard {
  kind: 'still';
  image: ImageBitmap;
  seconds: number;
}

/** An intro/outro clip (VID-5). Played once at normal speed. */
export interface ClipCard {
  kind: 'clip';
  file: Blob;
  /** Cap, so a long clip can't dominate the output (1–5 s per VID-5). */
  maxSeconds: number;
}

export type Card = StillCard | ClipCard;

/**
 * CAP-10: what replaces everything but the person in the guest's footage (cards and the overlay are
 * untouched). An image is transferred to the worker; a video is decoded there and played in step with the
 * take, starting over if it is shorter.
 */
export type RenderBackground =
  | { kind: 'color'; color: string }
  | { kind: 'blur' }
  | { kind: 'image'; image: ImageBitmap }
  | { kind: 'video'; file: Blob };

export interface RenderJob {
  take: Blob;
  output: { width: number; height: number; fps: number; bitrate: number };
  slowMotion: SlowMotion;
  reverse: 'none' | 'boomerang' | 'reverse';
  /** Transparent overlay at output size (VID-4), composited on every video frame. */
  overlay?: ImageBitmap | null;
  intro?: Card | null;
  outro?: Card | null;
  /** DL-4: QR end card, 2 s by default. */
  endCard?: StillCard | null;
  /** Pre-mixed soundtrack covering the whole output (planar float32). */
  audio?: { sampleRate: number; channels: Float32Array[] } | null;
  /** VID-11: the event's colour look (an @immersia/effects id). */
  look?: { id: string; intensity: number } | null;
  /** VID-7: effects in order, each with its strength and colour mode. */
  effects?: { id: string; intensity: number; colorMode: ColorMode | null }[];
  /** VID-12: beat times on the output timeline in seconds; none = a steady 120 BPM grid. */
  beats?: number[];
  /** Makes effects' randomness repeatable: the same take always renders the same way. */
  seed?: number;
  /**
   * CAP-10: replace the background on-device, before the look is applied. Unset (or null) costs nothing
   * and renders exactly what a job without this field renders.
   */
  background?: RenderBackground | null;
}

export interface RenderResult {
  mp4: Blob;
  durationS: number;
  width: number;
  height: number;
  frames: number;
  interpolatedFrames: number;
  renderMs: number;
  /**
   * `applied`: the background was replaced. `unavailable`: one was asked for but the segmenter or the
   * background could not be started on this device, so the take was rendered as filmed. `none`: no
   * background was set.
   */
  background: 'none' | 'applied' | 'unavailable';
  source: { fps: number; durationS: number; codec: string | null };
}

export class RenderError extends Error {
  constructor(
    readonly code: 'undecodable' | 'unsupported_encoder' | 'encoder_stall' | 'gpu' | 'cancelled' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'RenderError';
  }
}

let aacReady: Promise<void> | null = null;

/**
 * MP4 needs AAC for universal playback. Desktop Linux Chrome and Firefox have no native AAC encoder,
 * so a WASM build of FFmpeg's encoder is registered there (once) and used transparently.
 */
function ensureAac(): Promise<void> {
  aacReady ??= (async () => {
    if (await canEncodeAudio('aac')) return;
    // ~1 MB of WASM: loaded only on browsers that need it (a separate chunk).
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
  })();
  return aacReady;
}

const cardSeconds = (c: Card | null | undefined) => (!c ? 0 : c.kind === 'still' ? c.seconds : c.maxSeconds);

/** Output duration before rendering, so the soundtrack can be mixed to fit (main thread). */
export function plannedDurationS(
  job: Pick<RenderJob, 'intro' | 'outro' | 'endCard' | 'slowMotion' | 'reverse' | 'output'>,
  takeDurationS: number,
): number {
  const frames = buildSourceTimes({
    durationS: takeDurationS,
    outputFps: job.output.fps,
    slowMotion: job.slowMotion,
    reverse: job.reverse,
  }).length;
  return frames / job.output.fps + cardSeconds(job.intro) + cardSeconds(job.outro) + cardSeconds(job.endCard);
}

/** H.264 needs even dimensions. */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function render(
  job: RenderJob,
  opts: {
    onProgress?: (p: number) => void;
    signal?: AbortSignal;
    /** Awaited before the render starts and after every frame: a pause hook (e.g. while the booth records). */
    gate?: () => Promise<void>;
    /**
     * Opens the person segmenter for a job with a background (CAP-10). The render closes what it gets, so a
     * caller that shares one returns a handle whose `close` does nothing. Without it such a job renders
     * as filmed.
     */
    segmenter?: () => Promise<MaskSource>;
  } = {},
): Promise<RenderResult> {
  const { signal, onProgress, gate } = opts;
  const check = () => {
    if (signal?.aborted) throw new RenderError('cancelled', 'Render cancelled');
  };
  await gate?.();
  check();
  // Timed from the real start, so render-speed figures exclude time spent paused.
  const started = performance.now();
  let pausedMs = 0;
  const pause = async () => {
    if (!gate) return;
    const t0 = performance.now();
    await gate();
    pausedMs += performance.now() - t0;
  };
  const width = even(job.output.width);
  const height = even(job.output.height);
  const fps = job.output.fps;

  const probe = await probeTake(job.take);
  if (!probe.decodable) {
    probe.input.dispose();
    throw new RenderError(
      'undecodable',
      `This browser can't decode ${probe.codec ?? 'this video'} (decoder config ${probe.decoderCodec ?? 'none'})`,
    );
  }

  const times = buildSourceTimes({
    durationS: probe.durationS,
    outputFps: fps,
    slowMotion: job.slowMotion,
    reverse: job.reverse,
  });
  const refs = resolveFrames(times, probe.pts);
  const introFrames = Math.round(cardSeconds(job.intro) * fps);
  const outroFrames = Math.round(cardSeconds(job.outro) * fps);
  const endFrames = Math.round(cardSeconds(job.endCard) * fps);
  const total = introFrames + refs.length + outroFrames + endFrames;

  let compositor: Compositor;
  try {
    compositor = new Compositor(new OffscreenCanvas(width, height), width, height);
  } catch (err) {
    throw new RenderError('gpu', err instanceof Error ? err.message : String(err));
  }
  try {
    const look = job.look ? findLook(job.look.id) : null;
    compositor.setGrade(
      look && look.id !== 'none' ? { frag: LOOK_FRAG, uniforms: lookUniforms(look.params, job.look!.intensity) } : null,
      (job.effects ?? []).flatMap((e) => {
        const def = findEffect(e.id);
        return def ? [{ def, intensity: e.intensity, colorMode: e.colorMode }] : [];
      }),
      job.seed ?? 0,
    );
  } catch (err) {
    // A shader that won't compile on this GPU: render without the look and effects, never fail the take.
    console.warn('[render] look/effects unavailable', err);
    compositor.setGrade(null, [], 0);
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

  let n = 0;
  let interpolated = 0;
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
      await Promise.race([video.add(n / fps, 1 / fps), timeout]);
    } finally {
      clearTimeout(timer);
    }
    n++;
    const p = n / total;
    if (p - lastProgress >= 0.01 || n === total) {
      lastProgress = p;
      onProgress?.(p);
    }
    await pause();
  };

  const frames = new FrameSource(probe);
  let background: BackgroundRun | null = null;
  let backgroundOutcome: BackgroundOutcome = 'none';
  try {
    // CAP-10, started up front so a missing model shows before the first frame, not in the middle.
    ({ run: background, outcome: backgroundOutcome } = await BackgroundRun.start(job.background, compositor, {
      segmenter: opts.segmenter,
      fps,
      frames: refs.length,
    }));
    await drawCard(job.intro, introFrames, compositor, fps, add, check);
    // The event overlay frames the guests' footage only, not the intro/outro.
    compositor.setOverlay(job.overlay ?? null);
    for await (const pair of frames.pairs(refs, signal)) {
      check();
      const geo = { width: probe.width, height: probe.height, rotation: probe.rotation };
      const takeT = pair.index / fps;
      const { phase, pulse } = beatState(introFrames / fps + takeT, job.beats ?? []);
      compositor.setClock({ time: takeT, duration: refs.length / fps, beat: phase, pulse });
      const a = pair.a.toVideoFrame();
      try {
        if (pair.b) {
          const b = pair.b.toVideoFrame();
          try {
            const ref = refs[pair.index]!;
            compositor.composeBlend(a, b, pair.alpha, geo, `${ref.a}:${ref.b}`);
          } finally {
            b.close();
          }
          interpolated++;
        } else {
          compositor.composeReal(a, geo);
        }
      } finally {
        a.close();
      }
      // The person is found in the frame as composed (real or interpolated), then the background goes
      // behind them, then the look, effects and overlay.
      await background?.prepare(pair.index);
      compositor.finish();
      await add();
    }
    check();
    background?.endFootage();
    compositor.setOverlay(null);
    await drawCard(job.outro, outroFrames, compositor, fps, add, check);
    await drawCard(job.endCard, endFrames, compositor, fps, add, check);
    if (audioSource && job.audio) {
      const { sampleRate, channels } = job.audio;
      const frames = channels[0]!.length;
      const planar = new Float32Array(frames * channels.length);
      channels.forEach((ch, i) => planar.set(ch.subarray(0, frames), i * frames));
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
    if (err instanceof RenderError) throw err;
    if (signal?.aborted) throw new RenderError('cancelled', 'Render cancelled');
    throw new RenderError('failed', err instanceof Error ? err.message : String(err));
  } finally {
    background?.stop();
    frames.dispose();
    compositor.dispose();
    probe.input.dispose();
  }
  if (background && !background.ok) backgroundOutcome = 'unavailable';

  return {
    mp4: new Blob([target.buffer!], { type: 'video/mp4' }),
    durationS: n / fps,
    width,
    height,
    frames: n,
    interpolatedFrames: interpolated,
    renderMs: Math.round(performance.now() - started - pausedMs),
    background: backgroundOutcome,
    source: { fps: probe.fps, durationS: probe.durationS, codec: probe.codec },
  };
}

async function drawCard(
  card: Card | null | undefined,
  frameCount: number,
  compositor: Compositor,
  fps: number,
  add: () => Promise<void>,
  check: () => void,
) {
  if (!card || frameCount === 0) return;
  if (card.kind === 'still') {
    for (let i = 0; i < frameCount; i++) {
      check();
      compositor.drawCard(card.image, card.image.width, card.image.height);
      await add();
    }
    return;
  }
  // A clip: sample it at the output rate, holding its last frame if it is shorter than its slot.
  let clip: TakeProbe | null = null;
  try {
    clip = await probeTake(card.file);
    const sink = new VideoSampleSink(clip.video);
    const times = Array.from(
      { length: frameCount },
      (_, i) => clip!.firstTimestamp + Math.min(i / fps, clip!.durationS - 0.001),
    );
    const geo = { width: clip.width, height: clip.height, rotation: clip.rotation };
    for await (const sample of sink.samplesAtTimestamps(times)) {
      check();
      // A missing frame holds the previous one (the canvas still shows it) to keep the frame count exact.
      if (!sample) {
        await add();
        continue;
      }
      const f = sample.toVideoFrame();
      try {
        compositor.drawReal(f, geo);
      } finally {
        f.close();
        sample.close();
      }
      await add();
    }
  } finally {
    clip?.input.dispose();
  }
}
