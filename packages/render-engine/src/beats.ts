/**
 * Beat sync (VID-12): the music's tempo and beat times, so effects pulse on the beat and slow motion
 * starts and ends on one. Pure TypeScript over decoded samples (no Web Audio), so it runs in a worker
 * or a test and gives the same answer everywhere.
 *
 * 1. Onset strength: spectral flux of log-magnitude spectra (how much new energy each frame brings).
 * 2. Tempo: the autocorrelation of that envelope, weighted towards 120 BPM so a half or double tempo
 *    only wins when the music really says so.
 * 3. Beats: dynamic programming (Ellis 2007): the best sequence of onsets about one period apart, so
 *    a drifting or slightly swung beat is followed rather than forced onto a rigid grid.
 */

/** Analysis runs at ~11–12 kHz: plenty for onsets, and a 30 s excerpt costs milliseconds. */
const TARGET_RATE = 11025;
const FRAME = 512;
const HOP = 128;
const MIN_BPM = 60;
const MAX_BPM = 190;
/**
 * Below this onset level there is no beat to follow (a held tone, silence): normalising would only
 * amplify rounding noise into a fake rhythm. Real music, even 40 dB down, is a hundred times above it.
 */
const MIN_ONSET_LEVEL = 1e-3;
/** Tempo prior: log-Gaussian around 120 BPM, one octave wide. */
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 1;
/** How strongly the tracker insists on the tempo between beats. */
const TIGHTNESS = 100;

export interface BeatAnalysis {
  bpm: number;
  /** Beat times in seconds from the start of the audio. */
  beats: number[];
  /** 0..1: how clearly the music has a steady beat (low for ambient or spoken audio). */
  confidence: number;
}

/** In-place iterative radix-2 FFT (re/im of length n, a power of two). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Onset strength per hop: spectral flux of the log spectrum, mean-removed and half-wave rectified. */
export function onsetEnvelope(
  samples: Float32Array,
  sampleRate: number,
): { env: Float64Array; frameRate: number; level: number } {
  const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  const bins = FRAME / 2;
  // Up to ~5 kHz: kicks, snares and claps; above that is mostly hiss for tempo purposes.
  const maxBin = Math.min(bins, Math.ceil((5000 / sampleRate) * FRAME));
  const window = new Float64Array(FRAME).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  let prev = new Float64Array(maxBin);
  let cur = new Float64Array(maxBin);
  const flux = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = samples[start + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    for (let k = 1; k < maxBin; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k]!, im[k]!));
      if (f > 0) sum += Math.max(0, cur[k]! - prev[k]!);
    }
    flux[f] = sum;
    [prev, cur] = [cur, prev];
  }
  // Remove the slowly varying level (a ~0.5 s moving average) so only onsets stand out.
  const frameRate = sampleRate / HOP;
  const half = Math.round(frameRate * 0.25);
  const prefix = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) prefix[i + 1] = prefix[i]! + flux[i]!;
  const env = new Float64Array(frames);
  for (let c = 0; c < frames; c++) {
    const lo = Math.max(0, c - half);
    const hi = Math.min(frames, c + half + 1);
    env[c] = Math.max(0, flux[c]! - (prefix[hi]! - prefix[lo]!) / (hi - lo));
  }
  // A ~20 ms Gaussian: onset peaks a frame or two wide would otherwise favour tempi whose period
  // falls on a whole number of frames over those that fall between frames.
  const smoothed = new Float64Array(frames);
  const kernel = [0.054, 0.242, 0.399, 0.242, 0.054];
  for (let i = 0; i < frames; i++) {
    let v = 0;
    for (let k = -2; k <= 2; k++) v += (env[Math.min(frames - 1, Math.max(0, i + k))] ?? 0) * kernel[k + 2]!;
    smoothed[i] = v;
  }
  env.set(smoothed);
  // Normalise to unit standard deviation: the DP's weights then mean the same for any song.
  let sq = 0;
  for (const v of env) sq += v * v;
  const sd = Math.sqrt(sq / Math.max(1, frames)) || 1;
  for (let i = 0; i < frames; i++) env[i] = env[i]! / sd;
  // How much onset energy there was at all (per analysed bin), before normalising.
  return { env, frameRate, level: sd / maxBin };
}

/** Tempo period in frames, from the prior-weighted autocorrelation of the onset envelope. */
export function estimatePeriod(env: Float64Array, frameRate: number): { period: number; strength: number } {
  const minLag = Math.max(2, Math.floor((60 / MAX_BPM) * frameRate));
  const maxLag = Math.min(env.length - 1, Math.ceil((60 / MIN_BPM) * frameRate));
  if (maxLag <= minLag) return { period: (60 / PRIOR_BPM) * frameRate, strength: 0 };
  // Lags up to twice the slowest tempo: each candidate is scored with its double too (below).
  const acMax = Math.min(env.length - 1, 2 * maxLag + 2);
  const ac = new Float64Array(acMax + 1);
  // Mean-removed (Pearson-style): an onset envelope is never negative, so a raw autocorrelation is
  // high at every lag and says nothing about how periodic the music is.
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  let variance = 0;
  for (const v of env) variance += (v - mean) ** 2;
  variance /= env.length;
  for (let lag = minLag; lag <= acMax; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += (env[i]! - mean) * (env[i - lag]! - mean);
    ac[lag] = variance > 1e-12 ? s / (env.length - lag) / variance : 0;
  }
  const priorPeriod = (60 / PRIOR_BPM) * frameRate;
  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const w = Math.exp(-0.5 * (Math.log2(lag / priorPeriod) / PRIOR_OCTAVES) ** 2);
    // A real period also correlates at twice its length; its half-tempo rival correlates at its own
    // double and quadruple. Adding half the double's score (Ellis's TPS2) evens that out, so the prior
    // can choose the tempo people actually move to.
    const score = w * (ac[lag]! + 0.5 * (ac[2 * lag] ?? 0));
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // Parabolic refinement between neighbouring lags: tempo to a fraction of a frame.
  const a = ac[best - 1] ?? ac[best]!;
  const b = ac[best]!;
  const c = ac[best + 1] ?? ac[best]!;
  const denom = a - 2 * b + c;
  const period = best + (denom < 0 ? (0.5 * (a - c)) / denom : 0);
  const strength = Math.max(0, Math.min(1, b));
  return { period, strength };
}

/** Beat frames by dynamic programming over the onset envelope (Ellis 2007). */
export function trackBeats(env: Float64Array, period: number): number[] {
  const n = env.length;
  if (n === 0) return [];
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let bestPrev = -1;
    let bestVal = 0;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const penalty = -TIGHTNESS * Math.log((t - p) / period) ** 2;
      const v = score[p]! + penalty;
      if (bestPrev < 0 || v > bestVal) {
        bestVal = v;
        bestPrev = p;
      }
    }
    score[t] = env[t]! + (bestPrev >= 0 ? Math.max(0, bestVal) : 0);
    back[t] = bestPrev >= 0 && bestVal > 0 ? bestPrev : -1;
  }
  // End on the best-scoring frame within the last period, then follow the chain back.
  let end = Math.max(0, n - Math.round(period));
  for (let t = end; t < n; t++) if (score[t]! > score[end]!) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]!) {
    beats.push(t);
    if (back[t]! < 0) break;
  }
  return beats.reverse();
}

/**
 * Tempo and beats of a decoded track (any channel count; mixed to mono). Only `[startS, startS +
 * durationS)` is analysed (the part of the song a video uses); beat times are from the track's start.
 */
export function analyseBeats(
  channels: Float32Array[],
  sampleRate: number,
  range: { startS?: number; durationS?: number } = {},
): BeatAnalysis {
  const length = channels[0]?.length ?? 0;
  const from = Math.min(length, Math.max(0, Math.floor((range.startS ?? 0) * sampleRate)));
  const to = range.durationS === undefined ? length : Math.min(length, from + Math.ceil(range.durationS * sampleRate));
  // Mix to mono and decimate by averaging (crude anti-aliasing is enough for onset energy).
  const factor = Math.max(1, Math.floor(sampleRate / TARGET_RATE));
  const rate = sampleRate / factor;
  const mono = new Float32Array(Math.floor((to - from) / factor));
  for (let i = 0; i < mono.length; i++) {
    let sum = 0;
    for (const ch of channels) for (let k = 0; k < factor; k++) sum += ch[from + i * factor + k]!;
    mono[i] = sum / (factor * channels.length);
  }
  const { env, frameRate, level } = onsetEnvelope(mono, rate);
  if (level < MIN_ONSET_LEVEL) return { bpm: 120, beats: [], confidence: 0 };
  const { period, strength } = estimatePeriod(env, frameRate);
  // The envelope's frame f is centred on sample f·HOP + FRAME/2 of the excerpt.
  const offsetS = from / sampleRate + FRAME / 2 / rate;
  const beats = trackBeats(env, period).map((f) => f / frameRate + offsetS);
  return { bpm: (60 * frameRate) / period, beats, confidence: strength };
}

/**
 * The music's beats on the output video's timeline: shifted by the start offset, cut to the trimmed
 * part of the song, inside the video (VID-6 settings).
 */
export function beatsOnOutput(
  beats: number[],
  music: { trimStartMs: number; trimEndMs: number | null; offsetMs: number },
  outputDurationS: number,
): number[] {
  const trimStart = music.trimStartMs / 1000;
  const trimEnd = music.trimEndMs === null ? Infinity : music.trimEndMs / 1000;
  const offset = music.offsetMs / 1000;
  return beats
    .filter((b) => b >= trimStart && b < trimEnd)
    .map((b) => offset + (b - trimStart))
    .filter((t) => t >= 0 && t <= outputDurationS);
}

/** Without music (or before it starts), effects still keep time: a steady 120 BPM grid. */
export const FALLBACK_BEAT_S = 0.5;

/**
 * Effect inputs at output time `t` (contract: uBeat = phase within the beat, uPulse = 1 on the beat
 * decaying to ~0 by the next).
 */
export function beatState(t: number, beats: number[]): { phase: number; pulse: number } {
  let prev = -Infinity;
  let next = Infinity;
  // Binary search: renders call this once per frame over a few hundred beats.
  let lo = 0;
  let hi = beats.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid]! <= t) {
      prev = beats[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (lo < beats.length) next = beats[lo]!;
  if (!Number.isFinite(prev) || !Number.isFinite(next)) {
    // Outside the music: the steady grid, anchored to the nearest known beat when there is one.
    const anchor = Number.isFinite(prev) ? prev : Number.isFinite(next) ? next : 0;
    const phase = ((((t - anchor) / FALLBACK_BEAT_S) % 1) + 1) % 1;
    return { phase, pulse: Math.exp(-4 * phase) };
  }
  const phase = (t - prev) / (next - prev);
  return { phase, pulse: Math.exp(-4 * phase) };
}

/**
 * VID-12 speed ramps on the beat: move the slow-motion segment's edges (by at most `maxShiftS` each)
 * so that, in the output, the slow motion starts on a beat and returns to normal speed on one.
 * `introS` is the intro card's length (the take starts after it). Returns the segment unchanged when
 * no beat is close enough.
 */
export function snapSlowMotion(
  seg: { startS: number; endS: number; speed: number },
  beatsOut: number[],
  introS: number,
  takeDurationS: number,
  maxShiftS = 0.4,
): { startS: number; endS: number } {
  const nearest = (t: number) => {
    let best: number | null = null;
    for (const b of beatsOut) if (best === null || Math.abs(b - t) < Math.abs(best - t)) best = b;
    return best !== null && Math.abs(best - t) <= maxShiftS ? best : null;
  };
  // Before the segment the take plays at normal speed, so output time = intro + source time.
  const startBeat = nearest(introS + seg.startS);
  const startS = startBeat === null ? seg.startS : Math.max(0, startBeat - introS);
  // Inside the segment, output time advances by (source time) / speed.
  const outEnd = introS + startS + (seg.endS - startS) / seg.speed;
  const endBeat = nearest(outEnd);
  let endS = endBeat === null ? seg.endS : startS + (endBeat - introS - startS) * seg.speed;
  endS = Math.min(takeDurationS, endS);
  if (endS <= startS + 0.25) return { startS: seg.startS, endS: seg.endS };
  return { startS, endS };
}
