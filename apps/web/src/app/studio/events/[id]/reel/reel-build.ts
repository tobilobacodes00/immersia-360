'use client';

import {
  clipSecondsFor,
  outputSize,
  planReel,
  probeTake,
  videoBitrate,
  type Aspect,
  type MontageFile,
  type MusicSettings,
  type ReelClip,
  type ReelPlan,
} from '@immersia/render-engine';
import { decodeMusic, mixReelMusic, reelBeats } from '@immersia/render-engine/audio';
import { RenderClient, RenderFailure } from '@immersia/render-engine/client';
import { uuidv7 } from '@immersia/shared';
import { workerUrl } from '@/lib/workers';
import type { HighlightItem, HighlightPlan, ReelLengthS, ReelQuality } from '@/server/highlights-core';
import { REEL_END_S, REEL_INTRO_S, renderReelEnd, renderReelIntro } from './reel-cards';
import { ReelError } from './reel-io';

/**
 * Builds the highlight reel in the operator's browser (LIV-14) with the same render engine the booth uses:
 * download the chosen captures, check each can be shown, analyse the music's beat, plan the cuts, then render the
 * montage in the render worker. Nothing is graded again: every capture already carries the event's look.
 */

export const REEL_FPS = 30;
/** Captures downloaded at once. */
const PARALLEL = 3;
/** Captures downloaded beyond what the reel needs, in case some cannot be used. */
const SPARE = 2;

export type ReelStage = 'downloading' | 'analysing' | 'rendering' | 'finishing';

export interface ReelProgress {
  stage: ReelStage;
  /** 0 … 1 through the stage. */
  fraction: number;
  /** Downloading: captures fetched, and how many are wanted. */
  done?: number;
  total?: number;
}

export interface BuiltReel {
  mp4: Blob;
  poster: Blob | null;
  durationS: number;
  width: number;
  height: number;
  clips: number;
  /** The sessions whose footage is in the reel. */
  sessionIds: string[];
  /** The cuts sit on the music's beats. */
  beatSynced: boolean;
  hasMusic: boolean;
  renderMs: number;
}

export interface ReelBuildInput {
  plan: HighlightPlan;
  lengthS: ReelLengthS;
  quality: ReelQuality;
  aspect: Aspect;
  /** Cut on the beat (cross-fade when the event has no music to follow) or always cross-fade. */
  transitions: 'beat' | 'fade';
  /** Already translated. */
  text: { introSubtitle: string; dateLabel: string; endHint: string };
  onProgress: (p: ReelProgress) => void;
  signal: AbortSignal;
}

interface Gathered {
  item: HighlightItem;
  file: MontageFile;
  clip: ReelClip;
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

async function download(url: string, signal: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new ReelError('download', `${res.status}`);
  return res.blob();
}

/** One capture, downloaded and checked: null when this browser cannot show it. */
async function load(item: HighlightItem, signal: AbortSignal): Promise<Gathered | null> {
  const blob = await download(item.url, signal);
  const base = { id: item.sessionId, weight: item.weight, capturedAtMs: item.capturedAt };
  if (item.kind === 'still') {
    const picture = await createImageBitmap(blob).catch(() => null);
    if (!picture) return null;
    picture.close();
    return { item, file: { kind: 'still', file: blob }, clip: { ...base, kind: 'still' } };
  }
  const probe = await probeTake(blob).catch(() => null);
  if (!probe) return null;
  try {
    if (!probe.decodable) return null;
    // The booth's own intro, outro and QR card are not what a reel is for: only what lies between them.
    const usable = { fromS: item.headS, toS: probe.durationS - item.tailS };
    return { item, file: { kind: 'video', file: blob }, clip: { ...base, kind: 'video', usable } };
  } finally {
    probe.input.dispose();
  }
}

/** The best captures, in rank order, until there are enough that can be shown. Several download at a time. */
async function gather(
  items: HighlightItem[],
  want: number,
  signal: AbortSignal,
  onProgress: (p: ReelProgress) => void,
): Promise<Gathered[]> {
  const found: (Gathered | null)[] = items.map(() => null);
  let next = 0;
  let good = 0;
  const total = Math.min(items.length, want);
  const worker = async () => {
    while (good < want && next < items.length) {
      signal.throwIfAborted();
      const index = next++;
      try {
        found[index] = await load(items[index]!, signal);
        if (found[index]) good++;
      } catch (err) {
        // A capture that will not download is passed over; the reel is built from the rest.
        if (isAbort(err) || signal.aborted) throw err;
      }
      onProgress({ stage: 'downloading', fraction: Math.min(1, good / want), done: Math.min(good, total), total });
    }
  };
  onProgress({ stage: 'downloading', fraction: 0, done: 0, total });
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return found.filter((g): g is Gathered => g !== null);
}

export async function buildHighlightReel(input: ReelBuildInput): Promise<BuiltReel> {
  const { plan, lengthS, signal, onProgress } = input;
  const size = outputSize(input.quality, input.aspect);
  const want = Math.max(1, Math.round((lengthS - REEL_INTRO_S - REEL_END_S) / clipSecondsFor(lengthS))) + SPARE;

  let client: RenderClient | null = null;
  try {
    const gathered = await gather(plan.items, want, signal, onProgress);
    if (gathered.length === 0) throw new ReelError('nothing');

    // The event's music: its beats decide where the cuts fall, and it plays under the reel.
    onProgress({ stage: 'analysing', fraction: 0 });
    let song: AudioBuffer | null = null;
    if (plan.music) {
      try {
        song = await decodeMusic(await download(plan.music.url, signal));
      } catch (err) {
        if (isAbort(err) || signal.aborted) throw err;
        song = null; // a reel without music is still a reel
      }
    }
    const music: MusicSettings | null =
      plan.music && song ? { ...plan.music.settings, offsetMs: 0, fadeInMs: 400, fadeOutMs: 2500 } : null;
    const beats = song && music ? reelBeats(song, music, lengthS + 6).beats : [];

    const reel: ReelPlan = planReel(
      gathered.map((g) => g.clip),
      {
        targetS: lengthS,
        fps: REEL_FPS,
        introS: REEL_INTRO_S,
        endS: REEL_END_S,
        style: input.transitions === 'beat' ? 'cut' : 'crossfade',
        beats,
      },
    );
    if (reel.clips === 0) throw new ReelError('nothing');
    signal.throwIfAborted();

    const [audio, intro, end] = await Promise.all([
      song && music ? mixReelMusic(song, music, reel.totalS) : null,
      renderReelIntro({
        aspect: input.aspect,
        size,
        theme: plan.event.theme,
        eventName: plan.event.name,
        subtitle: input.text.introSubtitle,
        dateLabel: input.text.dateLabel,
      }),
      renderReelEnd({
        aspect: input.aspect,
        size,
        theme: plan.event.theme,
        eventName: plan.event.name,
        hint: input.text.endHint,
        link: plan.event.galleryUrl,
      }),
    ]);
    onProgress({ stage: 'analysing', fraction: 1 });

    client = new RenderClient(() => new Worker(workerUrl('render'), { type: 'module' }));
    const id = `reel-${uuidv7()}`;
    const handle = client.montage(
      id,
      {
        plan: reel,
        clips: gathered.map((g) => g.file),
        intro,
        end,
        output: { ...size, fps: REEL_FPS, bitrate: videoBitrate('balanced', size.width, size.height, REEL_FPS) },
        audio,
      },
      (fraction) => onProgress({ stage: 'rendering', fraction }),
    );
    const cancel = () => handle.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    const result = await handle.result.finally(() => signal.removeEventListener('abort', cancel));

    // A poster for the gallery's player, made in the same worker; a reel without one still plays.
    onProgress({ stage: 'finishing', fraction: 0 });
    const poster = await client
      .derive(`${id}:poster`, result.mp4, REEL_FPS, { poster: true, small: false })
      .then((d) => d.poster)
      .catch(() => null);

    return {
      mp4: result.mp4,
      poster,
      durationS: result.durationS,
      width: result.width,
      height: result.height,
      clips: reel.clips,
      sessionIds: reel.entries.flatMap((e) => (e.role === 'clip' ? [gathered[e.clip!]!.item.sessionId] : [])),
      beatSynced: reel.beatSynced,
      hasMusic: music !== null,
      renderMs: result.renderMs,
    };
  } catch (err) {
    if (err instanceof ReelError) throw err;
    if (isAbort(err) || signal.aborted) throw new ReelError('cancelled');
    if (err instanceof RenderFailure) {
      if (err.code === 'cancelled') throw new ReelError('cancelled');
      throw new ReelError(
        err.code === 'undecodable' || err.code === 'unsupported_encoder' ? 'unsupported' : 'failed',
        err.message,
      );
    }
    throw new ReelError('failed', err instanceof Error ? err.message : String(err));
  } finally {
    client?.dispose();
  }
}
