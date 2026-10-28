/**
 * On-device person segmentation (CAP-10) with MediaPipe Tasks Vision's selfie segmenter.
 *
 * Nothing leaves the device: the model (`selfie_segmenter.tflite`, float16, 256×256) and the WebAssembly
 * runtime are same-origin static files (apps/web/scripts/fetch-segmentation.mjs puts them in
 * `public/mediapipe/`), cached by the service worker so a booth segments offline. The wrapper runs on the
 * main thread and inside a (module) Web Worker, where MediaPipe makes its own OffscreenCanvas.
 *
 * It returns the person's probability per pixel, 0..1 and top row first, at (about) the size of the frame it
 * was given scaled to `maxSide`: the render engine upsamples it edge-aware against the full-size frame.
 */
import type { ImageSegmenter } from '@mediapipe/tasks-vision';

/** Where the build serves the model and the wasm runtime from. */
export const MEDIAPIPE_BASE = '/mediapipe';
export const SELFIE_MODEL_URL = `${MEDIAPIPE_BASE}/selfie_segmenter.tflite`;
export const SEGMENTER_ASSETS = { wasmBase: MEDIAPIPE_BASE, modelUrl: SELFIE_MODEL_URL } as const;

export type SegmenterDelegate = 'GPU' | 'CPU';

export interface SegmenterOptions {
  /** Directory holding the tasks-vision wasm files, e.g. `/mediapipe`. */
  wasmBase: string;
  modelUrl: string;
  /** The backend to prefer. A GPU that cannot run the model falls back to the CPU. Default `GPU`. */
  delegate?: SegmenterDelegate;
  /** Longest side the frame is scaled to before inference; the model itself works at 256. Default 256. */
  maxSide?: number;
}

export interface SegmentationMask {
  /** The probability that each pixel belongs to a person: 0..1, row-major, top row first. */
  data: Float32Array;
  width: number;
  height: number;
}

export interface Segmenter {
  /** The backend actually running (after any fallback). */
  readonly delegate: SegmenterDelegate;
  /**
   * Segment one frame. `timestampMs` should rise from frame to frame (VIDEO running mode); a value that
   * does not is nudged up, so callers may pass any monotonic-ish clock.
   */
  mask(frame: TexImageSource, timestampMs: number): Promise<SegmentationMask>;
  close(): void;
}

export class SegmenterError extends Error {
  constructor(
    readonly code: 'init' | 'inference' | 'closed',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SegmenterError';
  }
}

const DEFAULT_MAX_SIDE = 256;

/** Width and height of any frame type the browser can hand us. */
export function frameSize(frame: TexImageSource): { width: number; height: number } {
  const f = frame as Partial<Record<'videoWidth' | 'naturalWidth' | 'displayWidth' | 'width', number>> &
    Partial<Record<'videoHeight' | 'naturalHeight' | 'displayHeight' | 'height', number>>;
  if (f.videoWidth) return { width: f.videoWidth, height: f.videoHeight ?? 0 };
  if (f.displayWidth) return { width: f.displayWidth, height: f.displayHeight ?? 0 };
  if (f.naturalWidth) return { width: f.naturalWidth, height: f.naturalHeight ?? 0 };
  return { width: f.width ?? 0, height: f.height ?? 0 };
}

/** The size a frame is scaled to for inference: its long side at most `maxSide`, never upscaled. */
export function inferenceSize(width: number, height: number, maxSide = DEFAULT_MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The next timestamp a VIDEO-mode task accepts: strictly after the previous one, whole milliseconds. */
export function nextTimestamp(requested: number, last: number): number {
  const t = Number.isFinite(requested) ? Math.round(requested) : 0;
  return Math.max(t, last + 1);
}

/**
 * One mask of "how person-like" from whatever the model emits. The selfie segmenter has a single class
 * ("selfie"): its mask is the person. A model with a background class gives the person as everything
 * that is not background, however many other classes it has.
 */
export function personProbability(labels: readonly string[], masks: readonly ArrayLike<number>[]): Float32Array {
  if (masks.length === 0) throw new SegmenterError('inference', 'The segmenter returned no mask');
  const background = labels.findIndex((l) => /^(background|bg)$/i.test(l.trim()));
  const out = new Float32Array(masks[0]!.length);
  if (background < 0 || masks.length < 2 || !masks[background]) {
    for (let i = 0; i < out.length; i++) out[i] = masks[0]![i]!;
  } else {
    const bg = masks[background]!;
    for (let i = 0; i < out.length; i++) out[i] = 1 - bg[i]!;
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, out[i]!));
  return out;
}

/** A 2D canvas for scaling frames down. */
interface Scratch {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
}

/**
 * An OffscreenCanvas wherever one exists (so it works in workers). Browsers without it (Safari before 16.4)
 * get a DOM canvas, which has the same drawing surface; reached through `globalThis` because this file also
 * compiles for workers, where there is no DOM.
 */
function scratchCanvas(width: number, height: number): Scratch {
  let canvas: OffscreenCanvas | null;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(width, height);
  else {
    const doc = (globalThis as unknown as { document?: { createElement(tag: 'canvas'): unknown } }).document;
    canvas = (doc?.createElement('canvas') as OffscreenCanvas | undefined) ?? null;
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
    }
  }
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) throw new SegmenterError('inference', 'A 2D canvas is not available');
  return { canvas, ctx };
}

/** True inside a worker created with `{ type: 'module' }`, where `importScripts` exists but always throws. */
function inModuleWorker(): boolean {
  if ('document' in globalThis || typeof importScripts !== 'function') return false;
  try {
    importScripts();
    return false;
  } catch {
    return true;
  }
}

class MediaPipeSegmenter implements Segmenter {
  private lastTimestamp = -1;
  private closed = false;
  private scratch: Scratch | null = null;
  private readonly labels: string[];

  constructor(
    private readonly task: ImageSegmenter,
    readonly delegate: SegmenterDelegate,
    private readonly maxSide: number,
  ) {
    this.labels = task.getLabels();
  }

  /** The frame at inference size on a scratch canvas (a copy, so the caller's frame is never held). */
  private async scaled(frame: TexImageSource): Promise<Scratch['canvas']> {
    const { width, height } = frameSize(frame);
    if (!width || !height) throw new SegmenterError('inference', 'The frame has no size');
    const to = inferenceSize(width, height, this.maxSide);
    if (!this.scratch || this.scratch.canvas.width !== to.width || this.scratch.canvas.height !== to.height)
      this.scratch = scratchCanvas(to.width, to.height);
    const { canvas, ctx } = this.scratch;
    if (typeof ImageData !== 'undefined' && frame instanceof ImageData) {
      if (to.width === width && to.height === height) ctx.putImageData(frame, 0, 0);
      else {
        // putImageData cannot scale: go through a bitmap.
        const bitmap = await createImageBitmap(frame);
        ctx.drawImage(bitmap, 0, 0, to.width, to.height);
        bitmap.close();
      }
    } else ctx.drawImage(frame as CanvasImageSource, 0, 0, to.width, to.height);
    return canvas;
  }

  async mask(frame: TexImageSource, timestampMs: number): Promise<SegmentationMask> {
    if (this.closed) throw new SegmenterError('closed', 'The segmenter was closed');
    return this.run(await this.scaled(frame), timestampMs);
  }

  /** Inference on an already-scaled canvas. Synchronous inside MediaPipe; the result is copied out. */
  private run(input: Scratch['canvas'], timestampMs: number): SegmentationMask {
    const ts = nextTimestamp(timestampMs, this.lastTimestamp);
    this.lastTimestamp = ts;
    // Held in an object: a plain `let` assigned in the callback is narrowed to null afterwards.
    const result: { mask: SegmentationMask | null } = { mask: null };
    this.task.segmentForVideo(input, ts, (r) => {
      const masks = r.confidenceMasks;
      if (!masks?.length) return;
      // Copied here: the masks are only valid until this callback returns.
      result.mask = {
        data: personProbability(
          this.labels,
          masks.map((m) => m.getAsFloat32Array()),
        ),
        width: masks[0]!.width,
        height: masks[0]!.height,
      };
    });
    if (!result.mask) throw new SegmenterError('inference', 'The segmenter returned no mask');
    return result.mask;
  }

  /** One inference on a blank frame: shaders compile now, and a delegate that cannot run the model fails here. */
  warmUp() {
    const { canvas, ctx } = scratchCanvas(this.maxSide, this.maxSide);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, this.maxSide, this.maxSide);
    this.run(canvas, 0);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.task.close();
    this.scratch = null;
  }
}

/**
 * Load the model and the runtime, ready to segment. Prefers the GPU and quietly falls back to the CPU when
 * the GPU delegate cannot start or cannot run the model; throws a `SegmenterError('init')` when neither can
 * (files missing, no WebAssembly), which callers answer by carrying on without background replacement.
 */
export async function createSegmenter(options: SegmenterOptions): Promise<Segmenter> {
  const maxSide = options.maxSide ?? DEFAULT_MAX_SIDE;
  const order: SegmenterDelegate[] = (options.delegate ?? 'GPU') === 'GPU' ? ['GPU', 'CPU'] : ['CPU'];
  let failure: unknown;
  try {
    // Loaded on demand: the runtime is code a booth without a background never needs.
    const vision = await import('@mediapipe/tasks-vision');
    // A module worker cannot importScripts the classic loader: MediaPipe ships an ES module build for it.
    const fileset = await vision.FilesetResolver.forVisionTasks(options.wasmBase, inModuleWorker());
    for (const delegate of order) {
      let task: ImageSegmenter | null = null;
      try {
        task = await vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: options.modelUrl, delegate },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
        const segmenter = new MediaPipeSegmenter(task, delegate, maxSide);
        segmenter.warmUp();
        return segmenter;
      } catch (err) {
        failure = err;
        task?.close();
      }
    }
  } catch (err) {
    failure = err;
  }
  throw new SegmenterError(
    'init',
    `Could not start the segmenter: ${failure instanceof Error ? failure.message : String(failure)}`,
    { cause: failure },
  );
}

/**
 * Fetch the model and runtime through the service worker, which keeps them for offline use. Call it while
 * the booth is online and a background is set; failures are ignored (the first real use will try again).
 * `worker` also warms the ES-module runtime the render worker uses.
 */
export async function warmSegmenterAssets(opts: { base?: string; worker?: boolean } = {}): Promise<void> {
  const base = opts.base ?? MEDIAPIPE_BASE;
  const names = ['selfie_segmenter.tflite', 'vision_wasm_internal.js', 'vision_wasm_internal.wasm'];
  if (opts.worker) names.push('vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm');
  await Promise.allSettled(names.map((n) => fetch(`${base}/${n}`).then((r) => r.arrayBuffer())));
}
