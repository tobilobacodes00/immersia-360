import { createSegmenter } from '@immersia/capture/segment';
import {
  RenderError,
  messagingCopy,
  messagingSize,
  plannedDurationS,
  posterFrame,
  probeTake,
  render,
  wasmEncoderSupported,
  type Card,
  type EncoderKind,
  type RenderBackground,
  type RenderJob,
  type StillCard,
} from '@immersia/render-engine';
import { mixSoundtrack } from '@immersia/render-engine/audio';
import type { MaskSource } from '@immersia/render-engine/background';
import type { RenderRecipe, ServerRenderError } from '@immersia/shared/render';

/**
 * The page the render worker's Chrome loads. It is the booth's renderer, not a copy of it: the recipe
 * is turned back into the same `RenderJob` the booth would have built, and `render()` from
 * @immersia/render-engine does the work, through the same WebGL2 compositor and the same H.264 encode.
 * Only the host differs (headless Chrome on a server instead of a booth's browser).
 *
 * This module has no network or file code of its own: its inputs are Blobs, its outputs are Blobs. The
 * entry (entry.ts) feeds it from the worker's local file server; the smoke test feeds it fixtures.
 */

/** The media a recipe refers to. Absent files are null: the render goes without them, like a booth's. */
export interface RenderSources {
  original: Blob;
  overlay: Blob | null;
  endCard: Blob | null;
  intro: Blob | null;
  outro: Blob | null;
  music: Blob | null;
  background: Blob | null;
}

export interface RenderedFiles {
  mp4: Blob;
  poster: Blob | null;
  small: Blob | null;
  width: number;
  height: number;
  smallWidth: number;
  smallHeight: number;
  durationMs: number;
  frames: number;
  renderMs: number;
  /** Which encoder produced the video: Chrome's own, or the WebAssembly one when Chrome had none. */
  encoder: EncoderKind;
  /** `unavailable`: a background was asked for but the segmenter could not start, so the take went as filmed. */
  background: 'none' | 'applied' | 'unavailable';
}

export interface RenderOptions {
  /** Where the segmenter's model and runtime are served from (a same-origin directory). */
  mediapipeBase: string;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
  /** `auto` (default): Chrome's encoder, the WebAssembly one if Chrome has none. */
  encoder?: EncoderKind | 'auto';
}

/** A failure with the stable code the server stores. */
export class PageError extends Error {
  constructor(
    readonly code: ServerRenderError,
    message: string,
  ) {
    super(message);
    this.name = 'PageError';
  }
}

/** The server's code for a render engine error. */
export function codeOf(err: unknown): ServerRenderError {
  if (err instanceof PageError) return err.code;
  if (err instanceof RenderError) {
    switch (err.code) {
      case 'undecodable':
      case 'unsupported_encoder':
      case 'encoder_stall':
      case 'gpu':
        return err.code;
      case 'cancelled':
        return 'shutdown';
      default:
        return 'failed';
    }
  }
  return 'failed';
}

const bitmap = async (blob: Blob | null): Promise<ImageBitmap | null> =>
  blob ? createImageBitmap(blob).catch(() => null) : null;

/** The cards of a recipe as the engine takes them. A still that can not be read is left out, like on a booth. */
async function cardOf(c: RenderRecipe['intro'], blob: Blob | null): Promise<Card | null> {
  if (!c || !blob) return null;
  if (c.kind === 'video') return { kind: 'clip', file: blob, maxSeconds: c.seconds };
  const image = await bitmap(blob);
  return image ? { kind: 'still', image, seconds: c.seconds } : null;
}

async function backgroundOf(b: RenderRecipe['background'], blob: Blob | null): Promise<RenderBackground | null> {
  if (!b) return null;
  if (b.kind === 'color') return { kind: 'color', color: b.color };
  if (b.kind === 'blur') return { kind: 'blur' };
  if (!blob) return null;
  if (b.kind === 'video') return { kind: 'video', file: blob };
  const image = await bitmap(blob);
  return image ? { kind: 'image', image } : null;
}

/** Everything the job hands the renderer that has to be released afterwards. */
function release(job: RenderJob) {
  job.overlay?.close();
  if (job.background?.kind === 'image') job.background.image.close();
  if (job.intro?.kind === 'still') job.intro.image.close();
  if (job.outro?.kind === 'still') job.outro.image.close();
  job.endCard?.image.close();
}

/** The recipe plus its media, as the render job the booth would have built. */
export async function jobFromRecipe(recipe: RenderRecipe, src: RenderSources): Promise<RenderJob> {
  const [overlay, intro, outro, endImage, background] = await Promise.all([
    bitmap(src.overlay),
    cardOf(recipe.intro, src.intro),
    cardOf(recipe.outro, src.outro),
    bitmap(src.endCard),
    backgroundOf(recipe.background, src.background),
  ]);
  const endCard: StillCard | null =
    recipe.endCard && endImage ? { kind: 'still', image: endImage, seconds: recipe.endCard.seconds } : null;
  if (!endCard) endImage?.close();
  const job: RenderJob = {
    take: src.original,
    output: recipe.output,
    slowMotion: recipe.slowMotion,
    reverse: recipe.reverse,
    overlay,
    intro,
    outro,
    endCard,
    look: recipe.look,
    effects: recipe.effects,
    beats: recipe.beats,
    seed: recipe.seed,
    background,
  };
  if (recipe.music && src.music) {
    try {
      // The soundtrack is mixed to the exact output length, as on the booth (the plan is deterministic).
      const probe = await probeTake(src.original);
      probe.input.dispose();
      job.audio = await mixSoundtrack(src.music, recipe.music, plannedDurationS(job, probe.durationS));
    } catch (err) {
      // An undecodable song renders the video without it, as on a booth. An undecodable take fails below.
      console.warn('[render-page] soundtrack unavailable', err);
    }
  }
  return job;
}

const segmenterFor = (base: string) => async (): Promise<MaskSource> => {
  // CPU: a server has no GPU worth the name, and the CPU path gives the same mask everywhere.
  const s = await createSegmenter({
    wasmBase: base,
    modelUrl: `${base}/selfie_segmenter.tflite`,
    delegate: 'CPU',
  });
  return { mask: (frame, ts) => s.mask(frame, ts), close: () => s.close() };
};

/**
 * Render a recipe to the guest's files: the video (with the soundtrack, cards, overlay, background,
 * look and effects), and the poster and the lighter messaging copy the recipe asks for.
 */
export async function renderFromRecipe(
  recipe: RenderRecipe,
  src: RenderSources,
  opts: RenderOptions,
): Promise<RenderedFiles> {
  const wanted = opts.encoder ?? 'auto';
  const order: EncoderKind[] = wanted === 'auto' ? ['native', 'wasm'] : [wanted];
  let last: unknown;
  for (const encoder of order) {
    if (encoder === 'wasm' && !wasmEncoderSupported()) break;
    // The engine closes nothing it was given: a fresh job (fresh bitmaps) for every attempt.
    const job = await jobFromRecipe(recipe, src);
    try {
      const result = await render(job, {
        encoder,
        signal: opts.signal,
        onProgress: opts.onProgress,
        segmenter: segmenterFor(opts.mediapipeBase),
      });
      const fps = recipe.output.fps;
      // Poster and messaging copy come from the finished video, low priority, like on the booth.
      const poster = recipe.derive.poster ? await posterFrame(result.mp4).catch(() => null) : null;
      const small = recipe.derive.small ? await messagingCopy(result.mp4, fps, { encoder }).catch(() => null) : null;
      const size = messagingSize(result.width, result.height);
      return {
        mp4: result.mp4,
        poster,
        small,
        width: result.width,
        height: result.height,
        smallWidth: size.width,
        smallHeight: size.height,
        durationMs: Math.round(result.durationS * 1000),
        frames: result.frames,
        renderMs: result.renderMs,
        encoder,
        background: result.background,
      };
    } catch (err) {
      last = err;
      // Only a missing or dying encoder is worth the WebAssembly one; anything else would fail the same way.
      if (!(err instanceof RenderError) || err.code !== 'unsupported_encoder') break;
    } finally {
      release(job);
    }
  }
  throw last instanceof Error ? last : new PageError('failed', String(last));
}
