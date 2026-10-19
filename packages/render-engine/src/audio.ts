/**
 * Soundtrack mixing (VID-6): the event's music, trimmed, offset, faded and levelled to exactly the
 * video's length. Runs on the main thread — OfflineAudioContext doesn't exist in workers — and
 * returns planar float32 channels the render worker encodes as AAC.
 */
import { analyseBeats } from './beats';

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
