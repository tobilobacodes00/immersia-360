import { musicBeats } from '@immersia/render-engine/audio';
import { beatsOnOutput, snapSlowMotion } from '@immersia/render-engine/beats';
import { plannedDurationFromCards, probeTake, type RenderJob } from '@immersia/render-engine';
import type { Video360Settings } from '@immersia/shared';

/**
 * The timing of one render that depends on the take and the song: where the slow-motion segment starts and
 * ends, and the beat times on the output timeline. Shared by the booth's own render (the `local` and `wasm`
 * rungs) and by the recipe it sends to the server (the `server` rung), so a take comes out the same
 * wherever it is rendered.
 */

/** Below this the song has no steady beat to follow (ambient, spoken): effects keep their own time. */
const MIN_BEAT_CONFIDENCE = 0.3;

/** One analysis per song and trim for the whole session (every take uses the same music). */
const beatCache = new Map<string, Promise<{ beats: number[]; confidence: number } | null>>();

export interface Timing {
  slowMotion: Video360Settings['slowMotion'];
  beats: number[];
  /** The take's length when it was measured (only with a soundtrack, which has to fit it). */
  takeDurationS: number | null;
}

export async function planTiming(input: {
  video: Video360Settings;
  take: Blob;
  /** The event's song, when it has one and this device has it. */
  music: Blob | null;
  output: RenderJob['output'];
  /** The lengths of the intro, outro and end card, in seconds (0 for none). */
  cards: { intro: number; outro: number; end: number };
}): Promise<Timing> {
  const { video, music, output, cards } = input;
  if (!music || !video.music) return { slowMotion: video.slowMotion, beats: [], takeDurationS: null };
  // The soundtrack is mixed to the exact output length, so the take is measured.
  const probe = await probeTake(input.take);
  probe.input.dispose();
  let slowMotion = video.slowMotion;
  let beats: number[] = [];
  if (video.beatSync) {
    // VID-12: effects pulse on the song's beats, and slow motion starts and ends on one.
    const settings = video.music;
    const key = `${settings.assetId}:${settings.trimStartMs}:${settings.trimEndMs}`;
    let analysis = beatCache.get(key);
    if (!analysis) {
      analysis = musicBeats(music, settings, 120).catch(() => null);
      beatCache.set(key, analysis);
    }
    const found = await analysis;
    if (found && found.confidence >= MIN_BEAT_CONFIDENCE) {
      const planned = (sm: Timing['slowMotion']) =>
        plannedDurationFromCards({ slowMotion: sm, reverse: video.reverse, output }, cards, probe.durationS);
      const roughS = planned(slowMotion) + 2;
      const onOutput = beatsOnOutput(found.beats, settings, roughS);
      if (video.slowMotion.enabled)
        slowMotion = {
          ...video.slowMotion,
          ...snapSlowMotion(video.slowMotion, onOutput, cards.intro, probe.durationS),
        };
      beats = beatsOnOutput(found.beats, settings, planned(slowMotion));
    }
  }
  return { slowMotion, beats, takeDurationS: probe.durationS };
}

/** The length of a card as the renderer counts it. */
export const cardSecondsOf = (c: { kind: 'still'; seconds: number } | { kind: 'clip'; maxSeconds: number } | null) =>
  !c ? 0 : c.kind === 'still' ? c.seconds : c.maxSeconds;

/** A stable 0..1000 seed per take: re-rendering a take (anywhere on the ladder) gives the same confetti. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000;
}
