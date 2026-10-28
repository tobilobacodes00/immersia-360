/**
 * Soundtrack mixing (VID-6): the event's music, trimmed, offset, faded and levelled to exactly the
 * video's length. Runs on the main thread — OfflineAudioContext doesn't exist in workers — and
 * returns planar float32 channels the render worker encodes as AAC.
 */
import { analyseBeats, loopedBeats } from './beats';

export interface MusicSettings {
  trimStartMs: number;
  /** null = to the end of the file. */
  trimEndMs: number | null;
  /** Where in the video the music starts. */
  offsetMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  volume: number;
}

export const MIX_SAMPLE_RATE = 48_000;

/** Pure gain envelope, testable without Web Audio: [time, gain] points over the output. */
export function gainEnvelope(m: MusicSettings, musicDurationS: number, outputDurationS: number): [number, number][] {
  const start = m.offsetMs / 1000;
  const trimmedEnd = (m.trimEndMs ?? musicDurationS * 1000) / 1000;
  const playable = Math.max(0, trimmedEnd - m.trimStartMs / 1000);
  const end = Math.min(outputDurationS, start + playable);
  if (end <= start) return [];
  const fadeIn = Math.min(m.fadeInMs / 1000, (end - start) / 2);
  const fadeOut = Math.min(m.fadeOutMs / 1000, (end - start) / 2);
  const v = Math.max(0, Math.min(1, m.volume));
  const pts: [number, number][] = [[start, fadeIn > 0 ? 0 : v]];
  if (fadeIn > 0) pts.push([start + fadeIn, v]);
  if (fadeOut > 0) pts.push([end - fadeOut, v]);
  pts.push([end, fadeOut > 0 ? 0 : v]);
  return pts;
}

export async function mixSoundtrack(
  music: Blob,
  settings: MusicSettings,
  outputDurationS: number,
): Promise<{ sampleRate: number; channels: Float32Array[] }> {
  const length = Math.max(1, Math.ceil(outputDurationS * MIX_SAMPLE_RATE));
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: MIX_SAMPLE_RATE });
  const decoded = await ctx.decodeAudioData(await music.arrayBuffer());
  const env = gainEnvelope(settings, decoded.duration, outputDurationS);
  if (env.length) {
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, 0);
    for (const [t, g] of env) gain.gain.linearRampToValueAtTime(g, t);
    src.connect(gain).connect(ctx.destination);
    const start = env[0]![0];
    const trimStart = settings.trimStartMs / 1000;
    const duration = env.at(-1)![0] - start;
    src.start(start, trimStart, duration);
  }
  const rendered = await ctx.startRendering();
  return {
    sampleRate: rendered.sampleRate,
    channels: [rendered.getChannelData(0).slice(), rendered.getChannelData(1).slice()],
  };
}

/**
 * VID-12: the song's beat times (seconds from the song's start), analysed over the stretch a video
 * can use: from the trim start, `maxSeconds` long. Main thread (decodeAudioData); pure analysis.
 */
export async function musicBeats(
  music: Blob,
  settings: Pick<MusicSettings, 'trimStartMs' | 'trimEndMs'>,
  maxSeconds: number,
): Promise<{ beats: number[]; bpm: number; confidence: number }> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: MIX_SAMPLE_RATE });
  const decoded = await ctx.decodeAudioData(await music.arrayBuffer());
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  const start = settings.trimStartMs / 1000;
  const end = settings.trimEndMs === null ? decoded.duration : settings.trimEndMs / 1000;
  return analyseBeats(channels, decoded.sampleRate, { startS: start, durationS: Math.min(maxSeconds, end - start) });
}

/** The part of a song a reel plays: from the trim start to the trim end (or the song's end). */
function playedPart(settings: Pick<MusicSettings, 'trimStartMs' | 'trimEndMs'>, songS: number) {
  const from = Math.min(songS, settings.trimStartMs / 1000);
  const to = Math.min(songS, settings.trimEndMs === null ? songS : settings.trimEndMs / 1000);
  return { from, length: Math.max(0, to - from) };
}

/** A song decoded once, for both the beat analysis and the mix of a highlight reel (LIV-14). */
export async function decodeMusic(music: Blob): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: MIX_SAMPLE_RATE });
  return ctx.decodeAudioData(await music.arrayBuffer());
}

/**
 * The song's beats on the reel's timeline (which starts with the song's trimmed part), repeated when the
 * song is shorter than the reel and so plays again. Empty when the music has no steady beat to follow.
 */
export function reelBeats(
  song: AudioBuffer,
  settings: Pick<MusicSettings, 'trimStartMs' | 'trimEndMs'>,
  outputS: number,
  minConfidence = 0.3,
): { beats: number[]; bpm: number; confidence: number } {
  const { from, length } = playedPart(settings, song.duration);
  const channels = Array.from({ length: song.numberOfChannels }, (_, i) => song.getChannelData(i));
  const found = analyseBeats(channels, song.sampleRate, { startS: from, durationS: Math.min(length, 120) });
  const beats = found.confidence >= minConfidence ? loopedBeats(found.beats, from, length, outputS) : [];
  return { beats, bpm: found.bpm, confidence: found.confidence };
}

/**
 * A highlight reel's soundtrack (LIV-14): the song from its trim start, played over again when it is shorter
 * than the reel, faded in and out, at exactly the reel's length. Main thread, like `mixSoundtrack`.
 */
export async function mixReelMusic(
  song: AudioBuffer,
  settings: MusicSettings,
  outputS: number,
): Promise<{ sampleRate: number; channels: Float32Array[] }> {
  const length = Math.max(1, Math.ceil(outputS * MIX_SAMPLE_RATE));
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: MIX_SAMPLE_RATE });
  const { from, length: played } = playedPart(settings, song.duration);
  if (played > 0) {
    const src = ctx.createBufferSource();
    src.buffer = song;
    const loops = played < outputS;
    if (loops) {
      src.loop = true;
      src.loopStart = from;
      src.loopEnd = from + played;
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, 0);
    // The song starts with the reel, so its fades are the reel's: asked for as an envelope over a song as long as the reel.
    for (const [t, g] of gainEnvelope({ ...settings, offsetMs: 0, trimEndMs: null }, outputS + from, outputS))
      gain.gain.linearRampToValueAtTime(g, t);
    src.connect(gain).connect(ctx.destination);
    src.start(0, from, loops ? outputS : Math.min(played, outputS));
  }
  const rendered = await ctx.startRendering();
  return {
    sampleRate: rendered.sampleRate,
    channels: [rendered.getChannelData(0).slice(), rendered.getChannelData(1).slice()],
  };
}
