/**
 * The pure parts of background replacement (CAP-10): no GL, no DOM, so they run (and are tested) in Node.
 * The shaders in gl/background.ts implement the same formulas; the constants here are what they are given.
 */

/** What a segmenter returns: the probability that each pixel is a person, top row first. */
export interface PersonMask {
  data: Float32Array;
  width: number;
  height: number;
}

/** Anything that can find the person in a frame: the MediaPipe segmenter in the app, a stub in tests. */
export interface MaskSource {
  mask(frame: TexImageSource, timestampMs: number): Promise<PersonMask>;
  close(): void;
}

/** The long side of the frame handed to the segmenter (the selfie model works at 256×256). */
export const SEGMENT_SIDE = 256;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// -----------------------------------------------------------------------------------------------
// Temporal smoothing (stops the mask edge flickering from frame to frame)

/** How much of the new mask a pixel takes when it barely changed (0.5 = a plain average with the last). */
export const TEMPORAL_BASE = 0.5;
/** A change this big is real movement (not model jitter) and is followed at once. */
export const TEMPORAL_KNEE: readonly [number, number] = [0.3, 0.7];
/** Mean absolute change of the whole mask above which the picture has cut to something else. */
export const CUT_THRESHOLD = 0.2;

/**
 * The weight of the new mask value for a pixel whose value moved by `diff` since the last frame: jitter
 * (small changes) is averaged away, movement (large changes) is followed straight away, so a hand
 * moving does not leave a trail while an edge wobbling between 0.4 and 0.6 stays put.
 */
export function temporalWeight(diff: number, base = TEMPORAL_BASE): number {
  return base + (1 - base) * smoothstep(TEMPORAL_KNEE[0], TEMPORAL_KNEE[1], Math.abs(diff));
}

/** One step of the smoothing for one pixel: exponential with a motion-aware weight. */
export function blendMask(previous: number, current: number, base = TEMPORAL_BASE): number {
  return previous + (current - previous) * temporalWeight(current - previous, base);
}

/** Mean absolute difference between two masks of the same size (0 = identical, 1 = opposite). */
export function maskDifference(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

/** True when `current` is a different scene from `previous`, so smoothing across them would smear. */
export function isMaskCut(previous: PersonMask | null, current: PersonMask): boolean {
  if (!previous || previous.width !== current.width || previous.height !== current.height) return true;
  return maskDifference(previous.data, current.data) > CUT_THRESHOLD;
}

// -----------------------------------------------------------------------------------------------
// Edge-aware upsampling and the matte

/** The guide's colour difference (luminance-weighted) that halves-ish a neighbour's say in the upsample. */
export const GUIDE_SIGMA = 0.12;
/** Where the mask's highest and lowest value round a pixel differ by less than this, it is flat: no guide needed. */
export const FLAT_RANGE = 0.02;
/** Spatial falloff of the upsampling filter, in mask texels. */
export const GUIDE_SPATIAL_SIGMA = 0.75;
/**
 * The mask is a soft probability: pixels under `MATTE[0]` are background, over `MATTE[1]` person. Starting
 * above the middle trims the one-texel fringe where the model is unsure, so the old background does not
 * show as a halo round hair and shoulders.
 */
export const MATTE: readonly [number, number] = [0.35, 0.75];

/** Sigma, in output pixels, of the blur that feathers the matte edge (about 1.2 px at 1080 rows). */
export function featherSigma(outputHeight: number): number {
  return Math.min(2.2, Math.max(0.9, outputHeight * 0.0012));
}

/**
 * A Gaussian of `2 * pairs` texels radius as a centre tap plus `pairs` symmetric pairs of taps. Each pair
 * stands for two neighbouring texels (k = 2p − 1 and 2p) and sits between them, where the GPU's bilinear
 * filter returns their weighted mean for free, so the blur needs `1 + 2 * pairs` fetches rather than
 * `1 + 4 * pairs`, and no `exp` per pixel. The weights sum to 1: `center + 2 * Σ pairs[i].weight`.
 */
export interface GaussianTaps {
  center: number;
  pairs: { weight: number; offset: number }[];
}

export function gaussianLinearTaps(sigma: number, pairs: number): GaussianTaps {
  const g = (k: number) => Math.exp(-(k * k) / (2 * sigma * sigma));
  let total = g(0);
  for (let k = 1; k <= 2 * pairs; k++) total += 2 * g(k);
  return {
    center: g(0) / total,
    pairs: Array.from({ length: pairs }, (_, i) => {
      const a = 2 * i + 1;
      const w = g(a) + g(a + 1);
      return { weight: w / total, offset: (a * g(a) + (a + 1) * g(a + 1)) / w };
    }),
  };
}

/** The blurred-background working size: 1/8 of the output, never smaller than 8 px. */
export const BLUR_DOWNSCALE = 8;
export function blurSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(8, Math.ceil(width / BLUR_DOWNSCALE)),
    height: Math.max(8, Math.ceil(height / BLUR_DOWNSCALE)),
  };
}
/** Sigma of the background blur in texels of that smaller size (about 1.2% of the output height). */
export function blurSigma(outputHeight: number): number {
  return Math.min(3, Math.max(0.8, (outputHeight * 0.012) / BLUR_DOWNSCALE));
}

// -----------------------------------------------------------------------------------------------
// Video backgrounds

/**
 * Container times, from the clip's start, of the `n` output frames of one pass through a clip of
 * `durationS` seconds played at `fps` (the last frames hold the clip's end if it is shorter).
 */
export function loopTimes(n: number, fps: number, durationS: number): number[] {
  const last = Math.max(0, durationS - 1e-3);
  return Array.from({ length: n }, (_, k) => Math.min(k / fps, last));
}

// -----------------------------------------------------------------------------------------------
// Colours and scheduling

/** `#rrggbb` → 0..1 components, or null if it is not that. */
export function parseHexColor(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
}

/**
 * Paces segmentation on the live preview: at most `maxFps` runs a second, never two at once, and slower
 * still when a run takes long (a CPU-only device), so the preview and the capture are never starved.
 */
export class MaskThrottle {
  private nextAt = 0;
  private running = false;

  constructor(
    private readonly maxFps = 15,
    /** A run may use at most this share of the time it is waited for (0.3 = 30% of the main thread). */
    private readonly budget = 0.3,
  ) {}

  /** True if a run may start now at `nowMs`; the caller then calls `begin`. */
  ready(nowMs: number): boolean {
    return !this.running && nowMs >= this.nextAt;
  }

  begin() {
    this.running = true;
  }

  /** Call when a run is over, with the time it took and the time it ended. */
  end(durationMs: number, nowMs: number) {
    this.running = false;
    this.nextAt = nowMs + Math.max(1000 / this.maxFps - durationMs, durationMs / this.budget - durationMs, 0);
  }

  /** The run failed: wait a moment before the next try. */
  fail(nowMs: number) {
    this.running = false;
    this.nextAt = nowMs + 1000;
  }
}
