/**
 * The render timeline: for every frame of the output video, which source moment it shows.
 *
 * Two steps, so variable-frame-rate sources (MediaRecorder, phones) are handled correctly:
 *   1. buildSourceTimes: output frame → source time in seconds (speed ramps, reverse).
 *   2. resolveFrames:    source time → the real frames around it, using the take's actual
 *                        presentation timestamps, plus a blend factor between them.
 *
 * VID-1 slow motion: inside [startS, endS) the source advances `speed / outputFps` seconds per
 * output frame; elsewhere 1 / outputFps.
 * VID-2 smooth slow motion: when an output frame falls between two real frames it gets both and a
 * blend factor for the motion-compensated interpolator. With 120/240 fps sources real frames are
 * used directly. Either way no output frame repeats a source frame inside a slowed segment, which
 * is what makes slow motion stutter (acceptance #2).
 * VID-3 reverse: 'boomerang' plays the slow-motion segment forward, back, and forward again (the
 * whole clip when slow motion is off); 'reverse' appends the whole clip backwards.
 */

export interface SlowMotion {
  enabled: boolean;
  startS: number;
  endS: number;
  speed: number;
}

export interface TimelineInput {
  /** Duration of the source take, seconds. */
  durationS: number;
  outputFps: number;
  slowMotion: SlowMotion;
  reverse: 'none' | 'boomerang' | 'reverse';
}

/** One output frame of the video part. Indices point into the take's frame list (pts order). */
export interface VideoFrameRef {
  /** Source time in seconds (from the first frame) this frame represents. */
  t: number;
  /** Real frame shown, or the earlier of the blended pair. */
  a: number;
  /** Later frame of the blended pair, or null for a real frame. */
  b: number | null;
  /** Position between a (0) and b (1); 0 when b is null. */
  alpha: number;
}

/** Below this a blend is visually identical to the nearer frame: show the real frame. */
export const SNAP = 0.05;

/**
 * Forward source times for the whole take. Computed per output frame as the exact inverse of the
 * piecewise-linear "output time" function (normal → slowed → normal), never by accumulating small
 * steps: accumulated float error can step over a segment boundary and silently drop frames.
 */
function forwardTimes(durationS: number, outputFps: number, sm: SlowMotion): number[] {
  const slowed = sm.enabled && sm.endS > sm.startS && sm.speed > 0;
  const s = slowed ? sm.startS : durationS;
  const e = slowed ? sm.endS : durationS;
  const k = slowed ? sm.speed : 1;
  const slowOut = (e - s) / k; // output seconds spent in the slowed segment
  const totalOut = s + slowOut + (durationS - e);
  const frames = Math.ceil(totalOut * outputFps - 1e-9);
  const out = new Array<number>(frames);
  for (let n = 0; n < frames; n++) {
    const tau = n / outputFps;
    out[n] = tau < s ? tau : tau < s + slowOut ? s + (tau - s) * k : e + (tau - s - slowOut);
  }
  return out;
}

/** Step 1: source time for every output frame. */
export function buildSourceTimes(input: TimelineInput): number[] {
  const { durationS, outputFps } = input;
  if (!(durationS > 0) || !(outputFps > 0)) return [];
  const sm: SlowMotion = input.slowMotion.enabled
    ? {
        ...input.slowMotion,
        startS: Math.max(0, Math.min(input.slowMotion.startS, durationS)),
        endS: Math.max(0, Math.min(input.slowMotion.endS, durationS)),
      }
    : input.slowMotion;

  const all = forwardTimes(durationS, outputFps, sm);
  if (input.reverse === 'reverse') return [...all, ...all.slice(0, -1).reverse()];
  if (input.reverse === 'boomerang') {
    const [s, e] = sm.enabled && sm.endS > sm.startS ? [sm.startS, sm.endS] : [0, durationS];
    const before = all.filter((t) => t < s);
    const seg = all.filter((t) => t >= s && t < e);
    const after = all.filter((t) => t >= e);
    return [...before, ...seg, ...seg.slice(0, -1).reverse(), ...seg.slice(1), ...after];
  }
  return all;
}

/** Index of the last pts ≤ t (binary search); 0 if t precedes every frame. */
export function frameAtOrBefore(pts: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = pts.length - 1;
  if (hi < 0 || t <= pts[0]!) return 0;
  if (t >= pts[hi]!) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Step 2: map each source time onto the real frames (pts in seconds from the first frame). */
export function resolveFrames(times: number[], pts: ArrayLike<number>): VideoFrameRef[] {
  const last = pts.length - 1;
  if (last < 0) return [];
  return times.map((t) => {
    const a = frameAtOrBefore(pts, t);
    if (a >= last) return { t, a: last, b: null, alpha: 0 };
    const span = pts[a + 1]! - pts[a]!;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (t - pts[a]!) / span)) : 0;
    if (alpha < SNAP) return { t, a, b: null, alpha: 0 };
    if (alpha > 1 - SNAP) return { t, a: a + 1, b: null, alpha: 0 };
    return { t, a, b: a + 1, alpha };
  });
}

/** Evenly spaced pts for a constant-frame-rate source (and for tests). */
export function uniformPts(frameCount: number, fps: number): Float64Array {
  const out = new Float64Array(frameCount);
  for (let i = 0; i < frameCount; i++) out[i] = i / fps;
  return out;
}

/** Does this source need interpolation for the requested slow motion? (VID-2) */
export function needsInterpolation(sourceFps: number, outputFps: number, speed: number): boolean {
  return sourceFps * speed < outputFps * (1 - SNAP);
}

export const timelineDuration = (frames: { length: number }, outputFps: number) => frames.length / outputFps;

/**
 * Split the output into runs the decoder can serve efficiently: 'forward' runs visit frames in
 * non-decreasing order (stream from the original), 'backward' runs revisit earlier frames (served
 * from an all-keyframe cache so every frame decodes on its own).
 */
export interface FrameRun {
  direction: 'forward' | 'backward';
  start: number;
  end: number;
}

export function frameRuns(frames: VideoFrameRef[]): FrameRun[] {
  const runs: FrameRun[] = [];
  let prevHigh = -1;
  let prevLow = -1;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    const low = f.a;
    const high = f.b ?? f.a;
    const dir: FrameRun['direction'] =
      i > 0 && low < prevLow ? 'backward' : i > 0 && high < prevHigh ? 'backward' : 'forward';
    const cur = runs.at(-1);
    if (cur && cur.direction === dir) cur.end = i + 1;
    else runs.push({ direction: dir, start: i, end: i + 1 });
    prevHigh = high;
    prevLow = low;
  }
  return runs;
}
