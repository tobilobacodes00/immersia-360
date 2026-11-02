/**
 * The highlight reel's timeline (LIV-14): which clips play, for how long, where the music's beats put
 * the cuts, and what each output frame shows. Pure and DOM-free, so it runs on the main thread (to plan
 * and to mix the music to the planned length), in the render worker (to draw) and in tests.
 *
 * The reel is a sequence of entries on one timeline: an opening card, the clips, a closing card with the
 * event gallery's QR. Neighbours either cut or cross-fade; the boundary between two entries is where the
 * cut happens (or the middle of the fade), and boundaries are moved onto the nearest beat of the event's
 * music when there is one.
 */
import { coverCrop } from './gl/crop';
import { frameAtOrBefore, type VideoFrameRef } from './timeline';

/** The lengths an operator can ask for (seconds). */
export const REEL_LENGTHS = [30, 60, 90] as const;
export type ReelLength = (typeof REEL_LENGTHS)[number];

export type TransitionStyle = 'crossfade' | 'cut';

/** Shortest time a video clip stays on screen: below this a cut reads as a glitch. */
export const MIN_CLIP_S = 1.6;
/** Longest: a reel is a montage, not a playlist. */
export const MAX_VIDEO_CLIP_S = 6;
/** A photo strip needs a moment to be read, and its pan needs time to feel gentle. */
export const MIN_STILL_S = 2.4;
export const MAX_STILL_S = 4;
export const CROSSFADE_S = 0.5;

/** How long one clip is meant to stay for a reel of this length: longer reels breathe more. */
export function clipSecondsFor(targetS: number): number {
  return targetS <= 30 ? 2.5 : targetS <= 60 ? 3.5 : 4;
}

export interface ReelClip {
  id: string;
  kind: 'video' | 'still';
  /**
   * Video: the stretch of the file worth showing, in seconds from its first frame (the booth's own
   * intro, outro and QR end card are trimmed off). Ignored for stills.
   */
  usable?: { fromS: number; toS: number };
  /** 0 … 1, how highly it ranked (1 = best): better clips stay on screen a little longer. */
  weight: number;
  /** When it was captured (ms since the epoch): after the opening shot, clips play in the order they happened. */
  capturedAtMs: number;
}

export interface ReelOptions {
  /** The length asked for, cards included. The plan lands within a beat of it, or short when there is too little footage. */
  targetS: number;
  fps: number;
  /** Opening card length, 0 for none. */
  introS: number;
  /** Closing card length, 0 for none. */
  endS: number;
  style: TransitionStyle;
  /** Beat times on the reel's timeline in seconds; none = even spacing. */
  beats: number[];
  crossfadeS?: number;
}

export interface PlanEntry {
  role: 'intro' | 'clip' | 'end';
  /** Index into the clips given to `planReel` (clips only). */
  clip: number | null;
  kind: 'video' | 'still';
  /** On screen from `startS` to `endS` (the stretch shared with a cross-fade included). */
  startS: number;
  endS: number;
  /** The cross-fade that brings this entry in (0 = it cuts in, or opens the reel). */
  fadeInS: number;
  /** Video: where in the file the entry starts playing (at normal speed). */
  sourceInS: number;
  /** Position among the clips, to vary the Ken Burns moves. */
  seq: number;
}

export interface ReelPlan {
  entries: PlanEntry[];
  totalS: number;
  frames: number;
  /** Clips in the reel. */
  clips: number;
  /** Clips that could not be used (a video with too little footage). */
  dropped: string[];
  /** The cuts sit on the music's beats. */
  beatSynced: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function easeInOut(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/** The usual time between two beats (the median gap, so one missed beat doesn't skew it), or null. */
export function medianGap(beats: number[]): number | null {
  if (beats.length < 2) return null;
  const gaps = beats
    .slice(1)
    .map((b, i) => b - beats[i]!)
    .sort((a, b) => a - b);
  return gaps[gaps.length >> 1]!;
}

/**
 * Share `total` seconds out in proportion to `weights`, giving no slot less than `min` or more than `max`.
 * The sum falls short of `total` only when every slot is full; it exceeds it only when the minimums alone do.
 */
export function distributeSeconds(total: number, weights: number[], min: number[], max: number[]): number[] {
  const out = min.slice();
  let left = total - out.reduce((a, b) => a + b, 0);
  const open = new Set(out.flatMap((v, i) => (v < max[i]! - 1e-9 ? [i] : [])));
  while (left > 1e-9 && open.size) {
    const sum = [...open].reduce((a, i) => a + Math.max(weights[i]!, 1e-6), 0);
    let spent = 0;
    const full: number[] = [];
    for (const i of open) {
      const room = max[i]! - out[i]!;
      const give = Math.min((left * Math.max(weights[i]!, 1e-6)) / sum, room);
      out[i] = out[i]! + give;
      spent += give;
      if (give >= room - 1e-9) full.push(i);
    }
    left -= spent;
    // Nobody hit their limit: everyone took their whole share and nothing is left.
    if (!full.length) break;
    for (const i of full) open.delete(i);
  }
  return out;
}

/**
 * Move boundaries onto beats. `raw[k]` is where boundary k would fall; it goes to the nearest beat within
 * `tolerance`, as long as the clip before it keeps a length inside `[minLen[k], maxLen[k]]` (index 0 has no
 * clip before it). Boundaries are settled in order, so each one is judged against where its neighbour ended up;
 * one with no beat in reach keeps its place, brought back inside its limits.
 */
export function snapBoundaries(
  raw: number[],
  beats: number[],
  o: { tolerance: number; minLen: number[]; maxLen: number[] },
): number[] {
  const out = raw.slice();
  for (let k = 0; k < raw.length; k++) {
    const lo = k > 0 ? out[k - 1]! + o.minLen[k]! : -Infinity;
    const hi = k > 0 ? out[k - 1]! + o.maxLen[k]! : Infinity;
    const want = raw[k]!;
    let best: number | null = null;
    for (const b of beats) {
      if (b < lo - 1e-9 || b > hi + 1e-9) continue;
      const d = Math.abs(b - want);
      if (d > o.tolerance) continue;
      if (best === null || d < Math.abs(best - want)) best = b;
    }
    out[k] = best ?? clamp(want, lo, hi);
  }
  return out;
}

/** The order clips play in: the best one first as a hook, then the rest as the night unfolded. */
export function playOrder<T extends { capturedAtMs: number }>(ranked: T[]): T[] {
  const [hook, ...rest] = ranked;
  if (!hook) return [];
  return [hook, ...rest.sort((a, b) => a.capturedAtMs - b.capturedAtMs)];
}

export function planReel(clips: ReelClip[], o: ReelOptions): ReelPlan {
  const fadeS = o.style === 'crossfade' ? (o.crossfadeS ?? CROSSFADE_S) : 0;
  const half = fadeS / 2;
  const introS = Math.max(0, o.introS);
  const endS = Math.max(0, o.endS);
  const roomOf = (c: ReelClip) => (c.usable ? c.usable.toS - c.usable.fromS : 0);

  // A video with too little footage to cut or fade out of is left out, not stretched.
  const dropped: string[] = [];
  const eligible: number[] = [];
  clips.forEach((c, i) => {
    if (c.kind === 'video' && !(roomOf(c) >= MIN_CLIP_S + fadeS)) dropped.push(c.id);
    else eligible.push(i);
  });

  const section = Math.max(0, o.targetS - introS - endS);
  const minOf = (c: ReelClip) => (c.kind === 'still' ? MIN_STILL_S : MIN_CLIP_S);
  const maxOf = (c: ReelClip) =>
    c.kind === 'still' ? MAX_STILL_S : Math.max(MIN_CLIP_S, Math.min(MAX_VIDEO_CLIP_S, roomOf(c) - fadeS));

  // How many clips fit: the best ones, as many as the length asks for at a comfortable pace.
  let n = Math.min(eligible.length, Math.max(1, Math.round(section / clipSecondsFor(o.targetS))));
  while (n > 0 && eligible.slice(0, n).reduce((a, i) => a + minOf(clips[i]!), 0) > section) n--;
  const chosen = playOrder(eligible.slice(0, n).map((i) => ({ i, capturedAtMs: clips[i]!.capturedAtMs })));
  n = chosen.length;

  const entries: PlanEntry[] = [];
  const card = (role: 'intro' | 'end', startS: number, endAt: number, fadeInS: number): PlanEntry => ({
    role,
    clip: null,
    kind: 'still',
    startS,
    endS: endAt,
    fadeInS,
    sourceInS: 0,
    seq: 0,
  });

  if (n === 0) {
    // Nothing to show between the cards (or not even cards): a reel of what there is.
    if (introS > 0) entries.push(card('intro', 0, introS, 0));
    if (endS > 0) entries.push(card('end', introS, introS + endS, 0));
    const totalS = introS + endS;
    return { entries, totalS, frames: Math.round(totalS * o.fps), clips: 0, dropped, beatSynced: false };
  }

  const picked = chosen.map((c) => clips[c.i]!);
  const lengths = distributeSeconds(
    section,
    picked.map((c) => 0.8 + 0.4 * clamp(c.weight, 0, 1)),
    picked.map(minOf),
    picked.map(maxOf),
  );
  const raw = [introS];
  for (const len of lengths) raw.push(raw.at(-1)! + len);

  // Boundary k sits between clip k-1 and clip k (0 = the opening card, n = the closing card).
  const gap = medianGap(o.beats);
  const bounds =
    o.beats.length >= 4 && gap !== null
      ? snapBoundaries(raw, o.beats, {
          tolerance: Math.min(0.5, gap * 0.75),
          minLen: [0, ...picked.map(minOf)],
          maxLen: [0, ...picked.map(maxOf)],
        })
      : raw;
  const useBeats = bounds !== raw;
  // Boundary 0 only counts when an opening card gives it a place of its own.
  const counted = bounds.filter((_, k) => k > 0 || introS > 0);
  const beatSynced =
    useBeats &&
    counted.filter((b) => o.beats.some((x) => Math.abs(x - b) < 1e-6)).length >= Math.ceil(counted.length / 2);

  const totalS = bounds[n]! + endS;
  if (introS > 0) entries.push(card('intro', 0, bounds[0]! + half, 0));
  picked.forEach((c, k) => {
    const first = k === 0 && introS <= 0;
    const last = k === n - 1 && endS <= 0;
    const startAt = first ? 0 : Math.max(0, bounds[k]! - half);
    const endAt = last ? bounds[n]! : bounds[k + 1]! + half;
    const room = roomOf(c);
    entries.push({
      role: 'clip',
      clip: chosen[k]!.i,
      kind: c.kind,
      startS: startAt,
      endS: endAt,
      fadeInS: first ? 0 : fadeS,
      // The middle of the usable stretch: the booth's slow-motion moment, not its first or last frame.
      sourceInS: c.kind === 'video' ? c.usable!.fromS + clamp((room - (endAt - startAt)) / 2, 0, room) : 0,
      seq: k,
    });
  });
  if (endS > 0) entries.push(card('end', bounds[n]! - half, totalS, fadeS));
  return { entries, totalS, frames: Math.round(totalS * o.fps), clips: n, dropped, beatSynced };
}

export interface LayerAt {
  /** Index into `plan.entries`. */
  entry: number;
  /** Video: the time in the source file to show. */
  sourceS: number;
  /** 0 … 1 through the entry's time on screen (drives the Ken Burns move). */
  progress: number;
}

/** What output time `t` shows: one layer, or two while a cross-fade runs (`mix` 0 = only the first, 1 = only the second). */
export function layersAt(plan: ReelPlan, t: number): { layers: LayerAt[]; mix: number } {
  const e = plan.entries;
  const eps = 1e-9;
  let active: number[] = [];
  for (let i = 0; i < e.length; i++) if (t >= e[i]!.startS - eps && t < e[i]!.endS - eps) active.push(i);
  if (active.length === 0) {
    // Past the end (a last frame a rounding error beyond it) or in a gap: the nearest entry that has begun.
    let held = 0;
    for (let i = 0; i < e.length; i++) if (e[i]!.startS <= t + eps) held = i;
    active = [held];
  }
  active = active.slice(-2);
  const layer = (i: number): LayerAt => {
    const x = e[i]!;
    return {
      entry: i,
      sourceS: x.sourceInS + (t - x.startS),
      progress: clamp((t - x.startS) / Math.max(1e-9, x.endS - x.startS), 0, 1),
    };
  };
  if (active.length === 1) return { layers: [layer(active[0]!)], mix: 0 };
  const incoming = e[active[1]!]!;
  const mix = incoming.fadeInS > 0 ? easeInOut((t - incoming.startS) / incoming.fadeInS) : 1;
  return { layers: [layer(active[0]!), layer(active[1]!)], mix };
}

/** The layers of every output frame, in order. */
export function planFrames(plan: ReelPlan, fps: number) {
  return Array.from({ length: plan.frames }, (_, n) => layersAt(plan, n / fps));
}

/**
 * A gentle move over a still: a slow push in (now and then a pull out), and a pan through the picture. A
 * tall photo strip is travelled along its length, so a 9:16 reel shows all of it; a picture that already
 * fits the frame just drifts. `seq` alternates direction from one still to the next.
 */
export function kenBurns(
  progress: number,
  o: { imageW: number; imageH: number; outW: number; outH: number; seq: number },
): { zoom: number; panX: number; panY: number } {
  const e = easeInOut(progress);
  const base = coverCrop(o.imageW, o.imageH, 0, o.outW, o.outH);
  const roomX = 1 - base.scale[0];
  const roomY = 1 - base.scale[1];
  const dir = o.seq % 2 === 0 ? 1 : -1;
  const strip = Math.max(roomX, roomY) > 0.15;
  const travel = dir * (2 * e - 1);
  const along = (strip ? 0.9 : 0.35) * travel;
  const across = strip ? 0 : -0.25 * travel;
  const vertical = roomY >= roomX;
  return {
    zoom: 1 + 0.08 * (o.seq % 3 === 2 ? 1 - e : e),
    panX: vertical ? across : along,
    panY: vertical ? along : across,
  };
}

/**
 * The real frame nearest to each wanted source time (a montage plays footage at normal speed and never
 * blends frames: the optical-flow blend is for slow motion). Times are seconds from the first frame.
 */
export function sourceRefs(times: ArrayLike<number>, pts: ArrayLike<number>): VideoFrameRef[] {
  const last = pts.length - 1;
  if (last < 0) return [];
  return Array.from(times, (t) => {
    let a = frameAtOrBefore(pts, t);
    if (a < last && pts[a + 1]! - t < t - pts[a]!) a += 1;
    return { t, a, b: null, alpha: 0 };
  });
}
