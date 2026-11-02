import { MIX_SAMPLE_RATE } from '@immersia/render-engine/audio';
import { computePeaks, type Peaks } from './peaks';

/** Waveform resolution: enough for a 2000 px wide canvas at 2× without per-draw work on the song. */
const PEAK_BUCKETS = 1600;

export interface DecodedSong {
  /** Kept for the preview; the editor drops it with the component or when the source changes. */
  buffer: AudioBuffer;
  /** Same value the renderer feeds `gainEnvelope` (`decoded.duration`). */
  durationS: number;
  /** Whole milliseconds, rounded down, so a trim handle never sits past the last sample. */
  durationMs: number;
  peaks: Peaks;
}

/**
 * Decode at the render's own sample rate (48 kHz, like `mixSoundtrack`) so the duration the editor
 * trims against is the duration the renderer will see. An OfflineAudioContext decodes without
 * touching the audio hardware or needing a user gesture.
 */
export async function decodeSong(source: Blob): Promise<DecodedSong> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: MIX_SAMPLE_RATE });
  const buffer = await ctx.decodeAudioData(await source.arrayBuffer());
  // A file that decodes to nothing (or to under a millisecond) has nothing to trim.
  if (buffer.duration < 0.001) throw new Error('The audio is empty.');
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return {
    buffer,
    durationS: buffer.duration,
    durationMs: Math.floor(buffer.duration * 1000),
    peaks: computePeaks(channels, PEAK_BUCKETS),
  };
}
