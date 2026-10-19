/**
 * Motion trigger (CAP-4): start recording when horizontal movement crosses a threshold.
 *
 * Frames are downsampled to a small grayscale grid. Per sample we measure
 *   - energy: the share of pixels whose brightness changed by more than PIXEL_DELTA, and
 *   - shift:  the horizontal displacement that best aligns the two frames' column profiles
 *             (sum of absolute differences over shifts −MAX_SHIFT…MAX_SHIFT).
 * A spinning platform produces sustained energy AND a consistent non-zero shift; a guest walking up
 * to the camera produces energy with ~zero shift, and a light flicker produces energy that is
 * spread evenly with no best shift. Requiring both, for several consecutive samples, keeps false
 * starts rare.
 */

export const GRID_W = 64;
export const GRID_H = 36;
const PIXEL_DELTA = 18;
const MAX_SHIFT = 8;
/** Repeated frames tolerated inside a run (~0.5 s at 10 samples a second). */
const MAX_DUPLICATES = 5;

export interface MotionSample {
  /** 0–1: share of pixels that changed. */
  energy: number;
  /** Horizontal displacement in grid columns (positive = content moved right). */
  shift: number;
  /** How decisively `shift` beats no shift (0 = no better than zero shift). */
  confidence: number;
  /**
   * Byte-identical to the previous frame: the camera hasn't delivered a new one yet (sampling
   * faster than frames arrive, frames dropped under load). Real sensors are never this still.
   */
  duplicate: boolean;
}

/** Column brightness profile (mean of each column). */
function columnProfile(frame: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) s += frame[y * w + x]!;
    out[x] = s / h;
  }
  return out;
}

export function analyzeFrames(prev: Uint8Array, curr: Uint8Array, w = GRID_W, h = GRID_H): MotionSample {
  let changed = 0;
  let anyDiff = false;
  for (let i = 0; i < w * h; i++) {
    const d = Math.abs(curr[i]! - prev[i]!);
    if (d > PIXEL_DELTA) changed++;
    if (d !== 0) anyDiff = true;
  }
  const energy = changed / (w * h);

  const a = columnProfile(prev, w, h);
  const b = columnProfile(curr, w, h);
  const sad = (s: number) => {
    let total = 0;
    let n = 0;
    for (let x = Math.max(0, s); x < Math.min(w, w + s); x++) {
      total += Math.abs(b[x]! - a[x - s]!);
      n++;
    }
    return n ? total / n : Infinity;
  };
  const zero = sad(0);
  let best = 0;
  let bestSad = zero;
  for (let s = -MAX_SHIFT; s <= MAX_SHIFT; s++) {
    if (s === 0) continue;
    const v = sad(s);
    if (v < bestSad) {
      bestSad = v;
      best = s;
    }
  }
  const confidence = zero > 0 ? Math.max(0, (zero - bestSad) / zero) : 0;
  return { energy, shift: best, confidence, duplicate: !anyDiff };
}

export interface MotionTriggerOptions {
  /** CAP-4 threshold: share of the frame that must move (0.01–1). */
  threshold: number;
  /** Consecutive qualifying samples needed (at ~10 samples/s, 3 ≈ 0.3 s). */
  sustain?: number;
  /** Minimum |shift| in grid columns. */
  minShift?: number;
  /** Minimum confidence that the movement is sideways. */
  minConfidence?: number;
}

/** Stateful decision on top of `analyzeFrames`. Feed one sample per frame; true = start now. */
export class MotionTrigger {
  private run = 0;
  private duplicates = 0;
  private direction = 0;

  constructor(private opts: MotionTriggerOptions) {}

  update(sample: MotionSample): boolean {
    const { threshold, sustain = 3, minShift = 1, minConfidence = 0.15 } = this.opts;
    // No new frame is not "no motion": skip it, so a camera that drops frames (or a busy device)
    // can still complete a run. A feed frozen for longer than MAX_DUPLICATES is no evidence of a
    // spin, though, and ends the run.
    if (sample.duplicate) {
      if (++this.duplicates > MAX_DUPLICATES) this.reset();
      return false;
    }
    this.duplicates = 0;
    const sideways = Math.abs(sample.shift) >= minShift && sample.confidence >= minConfidence;
    const dir = Math.sign(sample.shift);
    if (sample.energy >= threshold && sideways && (this.run === 0 || dir === this.direction)) {
      this.direction = dir;
      this.run++;
    } else {
      this.run = 0;
      this.direction = 0;
    }
    if (this.run >= sustain) {
      this.run = 0;
      return true;
    }
    return false;
  }

  reset() {
    this.run = 0;
    this.direction = 0;
    this.duplicates = 0;
  }
}

/**
 * Downsample any drawable source to the analysis grid. Reuses one canvas; returns luma bytes.
 * `willReadFrequently` keeps the canvas on the CPU so getImageData doesn't stall the GPU.
 */
export function createFrameSampler() {
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (typeof OffscreenCanvas !== 'undefined') {
    ctx = new OffscreenCanvas(GRID_W, GRID_H).getContext('2d', { willReadFrequently: true });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = GRID_W;
    canvas.height = GRID_H;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!ctx) throw new Error('2D canvas unavailable');
  const c = ctx;
  return (source: CanvasImageSource): Uint8Array => {
    c.drawImage(source, 0, 0, GRID_W, GRID_H);
    const { data } = c.getImageData(0, 0, GRID_W, GRID_H);
    const out = new Uint8Array(GRID_W * GRID_H);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      out[i] = (data[p]! * 77 + data[p + 1]! * 150 + data[p + 2]! * 29) >> 8;
    }
    return out;
  };
}
