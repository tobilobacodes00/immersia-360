/**
 * Pure maths for the audio editor (no DOM, no Web Audio) so it can be unit-tested in node:
 * waveform peaks, trim-handle constraints, time formatting and normalising stored music settings.
 */

/** The music settings the editor edits: the event's `musicSchema` minus `assetId`. */
export interface MusicEdit {
  trimStartMs: number;
  /** null = to the end of the song. */
  trimEndMs: number | null;
  /** Where on the video's timeline the music starts. */
  offsetMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** 0–1. */
  volume: number;
}

/** The shortest slice of a song the operator can keep. */
export const MIN_TRIM_MS = 500;
/** `musicSchema` caps both fades at 10 s. */
export const MAX_FADE_MS = 10_000;

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
}

export interface TrimRange {
  startMs: number;
  endMs: number;
}

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);

/**
 * Min/max of the mono mix (mean of all channels) in `buckets` equal slices of the song. Computed once
 * per decode; drawing re-buckets these to whatever width the canvas has.
 */
export function computePeaks(channels: Float32Array[], buckets: number): Peaks {
  const n = Math.max(1, Math.floor(buckets));
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  const first = channels[0];
  if (!first) return { min, max };
  // Channels of a decoded buffer are equal length; take the shortest so a malformed input can't overrun.
  const length = channels.reduce((l, c) => Math.min(l, c.length), first.length);
  if (length === 0) return { min, max };

  const inv = 1 / channels.length;
  // Sum each bucket's channels into a scratch buffer, then scan it: two tight loops instead of an
  // indexed channel lookup per sample, which matters on a 10-minute stereo song (~58M samples).
  const scratch = new Float32Array(Math.ceil(length / n) + 1);
  for (let b = 0; b < n; b++) {
    const from = Math.floor((b * length) / n);
    const to = Math.min(length, Math.max(from + 1, Math.floor(((b + 1) * length) / n)));
    const len = to - from;
    scratch.fill(0, 0, len);
    for (const ch of channels) for (let i = 0; i < len; i++) scratch[i] = scratch[i]! + ch[from + i]!;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < len; i++) {
      const s = scratch[i]! * inv;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    // Only NaN samples leave the extremes untouched.
    min[b] = Number.isFinite(lo) ? lo : 0;
    max[b] = Number.isFinite(hi) ? hi : 0;
  }
  return { min, max };
}

/** Resample peaks to `columns` slices (drawing resolution), keeping each slice's true extremes. */
export function rebucketPeaks(peaks: Peaks, columns: number): Peaks {
  const cols = Math.max(1, Math.floor(columns));
  const min = new Float32Array(cols);
  const max = new Float32Array(cols);
  const n = peaks.min.length;
  if (n === 0) return { min, max };
  for (let c = 0; c < cols; c++) {
    const from = Math.floor((c * n) / cols);
    const to = Math.min(n, Math.max(from + 1, Math.ceil(((c + 1) * n) / cols)));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = from; i < to; i++) {
      if (peaks.min[i]! < lo) lo = peaks.min[i]!;
      if (peaks.max[i]! > hi) hi = peaks.max[i]!;
    }
    min[c] = lo;
    max[c] = hi;
  }
  return { min, max };
}

/** Largest absolute sample in the peaks, for scaling the drawing to the canvas height. */
export function peakAbs(peaks: Peaks): number {
  let m = 0;
  for (let i = 0; i < peaks.min.length; i++) m = Math.max(m, Math.abs(peaks.min[i]!), Math.abs(peaks.max[i]!));
  return m;
}

/**
 * Keep a trim range valid after one handle moved: 0 ≤ start < end ≤ duration with at least `minGapMs`
 * between them. The handle named in `moved` is the one that was dragged, so the other one holds still
 * and the dragged one stops against it. Songs shorter than the gap keep the whole song.
 */
export function clampTrim(
  range: TrimRange,
  moved: 'start' | 'end',
  durationMs: number,
  minGapMs: number = MIN_TRIM_MS,
): TrimRange {
  const dur = Math.max(0, Math.round(durationMs));
  const gap = Math.min(minGapMs, dur);
  let start = Math.round(clamp(range.startMs, 0, dur));
  let end = Math.round(clamp(range.endMs, 0, dur));
  if (moved === 'start') {
    start = Math.max(0, Math.min(start, end - gap));
    end = Math.max(end, start + gap);
  } else {
    end = Math.min(dur, Math.max(end, start + gap));
    start = Math.min(start, end - gap);
  }
  return { startMs: start, endMs: end };
}

/** `musicSchema` stores "to the end of the song" as null. */
export function trimEndOrNull(endMs: number, durationMs: number): number | null {
  return endMs >= durationMs ? null : endMs;
}

/** m:ss.s, truncated to tenths so a time never reads ahead of the position it names. */
export function formatTime(ms: number): string {
  const tenths = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

/** Gain of a `gainEnvelope` polyline at time `t` (seconds on the video's timeline). */
export function gainAt(envelope: readonly (readonly [number, number])[], t: number): number {
  const first = envelope[0];
  if (!first) return 0;
  if (t <= first[0]) return first[1];
  for (let i = 1; i < envelope.length; i++) {
    const [t1, g1] = envelope[i]!;
    if (t <= t1) {
      const [t0, g0] = envelope[i - 1]!;
      return t1 === t0 ? g1 : g0 + ((g1 - g0) * (t - t0)) / (t1 - t0);
    }
  }
  return envelope[envelope.length - 1]![1];
}

/**
 * Make stored settings valid for this song and video: trim inside the song, offset inside the video,
 * fades and volume inside the schema's ranges, and integers where the schema wants integers.
 */
export function fitMusic(m: MusicEdit, songMs: number, videoMs: number): MusicEdit {
  const trim = clampTrim({ startMs: m.trimStartMs, endMs: m.trimEndMs ?? songMs }, 'end', songMs);
  return {
    trimStartMs: trim.startMs,
    trimEndMs: trimEndOrNull(trim.endMs, songMs),
    offsetMs: Math.round(clamp(m.offsetMs, 0, Math.max(0, videoMs))),
    fadeInMs: Math.round(clamp(m.fadeInMs, 0, MAX_FADE_MS)),
    fadeOutMs: Math.round(clamp(m.fadeOutMs, 0, MAX_FADE_MS)),
    volume: clamp(m.volume, 0, 1),
  };
}

export function sameMusic(a: MusicEdit, b: MusicEdit): boolean {
  return (
    a.trimStartMs === b.trimStartMs &&
    a.trimEndMs === b.trimEndMs &&
    a.offsetMs === b.offsetMs &&
    a.fadeInMs === b.fadeInMs &&
    a.fadeOutMs === b.fadeOutMs &&
    a.volume === b.volume
  );
}
