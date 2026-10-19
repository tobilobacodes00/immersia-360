'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { RenderClient, RenderFailure, type RenderHandle } from '@immersia/render-engine/client';
import { mixSoundtrack, musicBeats } from '@immersia/render-engine/audio';
import { beatsOnOutput, snapSlowMotion } from '@immersia/render-engine/beats';
import {
  messagingSize,
  outputSize,
  plannedDurationS,
  probeTake,
  videoBitrate,
  type Card,
  type StillCard,
} from '@immersia/render-engine';
import { boothDb, outputsForTake, putOutput, type LocalTake, type TakeStore } from '@immersia/offline';
import type { Video360Settings } from '@immersia/shared';
import { workerUrl } from '@/lib/workers';

/** Below this the song has no steady beat to follow (ambient, spoken): effects keep their own time. */
const MIN_BEAT_CONFIDENCE = 0.3;

/** One analysis per song and trim for the whole session (every take uses the same music). */
const beatCache = new Map<string, Promise<{ beats: number[]; confidence: number } | null>>();

/** A stable 0..1000 seed per take: re-rendering a take gives the same confetti. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000;
}

/** Takes waiting to render. */
export const RENDERABLE: LocalTake['status'][] = ['recorded', 'interrupted', 'imported'];

/** The event's media for each render. Called per job: the worker takes ownership of what it is sent. */
export interface RenderAssets {
  overlay?: () => Promise<ImageBitmap | null>;
  music?: () => Promise<Blob | null>;
  intro?: () => Promise<Card | null>;
  outro?: () => Promise<Card | null>;
  /** DL-4: the closing QR card for this take's guest session. */
  endCard?: (take: LocalTake) => Promise<StillCard | null>;
}

export interface RenderState {
  takeId: string;
  progress: number;
}

/**
 * The booth's background render queue (VID-9): renders each finished take in the render worker,
 * oldest first, one at a time, while the operator keeps recording.
 *
 * The queue IS the device database: a take in a renderable status is queued. A tab that closes
 * mid-render leaves the take in `rendering`, which is reset on the next open — nothing is lost and
 * nothing gets stuck.
 */
export function useRenderQueue(opts: {
  eventId: string;
  video: Video360Settings;
  store: TakeStore | null;
  /** DL-8: also make the lighter copy for messaging apps (event setting, on by default). */
  smallerVersion?: boolean;
  /** While true, the current render parks between frames and no new one starts (e.g. mid-capture). */
  paused?: boolean;
  assets?: RenderAssets;
  onRendered?: (take: LocalTake, outputId: string) => void;
}) {
  const db = boothDb();
  const [current, setCurrent] = useState<RenderState | null>(null);
  const client = useRef<RenderClient | null>(null);
  const handle = useRef<RenderHandle | null>(null);
  const busy = useRef(false);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const paused = Boolean(opts.paused);
  const pausedRef = useRef(paused);
  const resumeWaiters = useRef<(() => void)[]>([]);
  const whenRunning = useCallback(
    () => (pausedRef.current ? new Promise<void>((r) => resumeWaiters.current.push(r)) : Promise.resolve()),
    [],
  );

  useEffect(() => {
    client.current = new RenderClient(() => new Worker(workerUrl('render'), { type: 'module' }));
    if (pausedRef.current) client.current.pause();
    // Takes stranded mid-render by a closed tab go back in the queue.
    void db.takes.where('status').equals('rendering').modify({ status: 'recorded' });
    return () => {
      client.current?.dispose();
      client.current = null;
    };
  }, [db]);

  useEffect(() => {
    pausedRef.current = paused;
    if (paused) {
      client.current?.pause();
      return;
    }
    client.current?.resume();
    for (const resume of resumeWaiters.current.splice(0)) resume();
  }, [paused]);

  const renderOne = useCallback(
    async (take: LocalTake) => {
      const { video, assets, store } = optsRef.current;
      if (!store || !client.current) return;
      await db.takes.update(take.id, { status: 'rendering', updatedAt: Date.now() });
      setCurrent({ takeId: take.id, progress: 0 });
      const started = Date.now();
      try {
        const blob = await store.read(take.path, take.mimeType);
        const size = outputSize(video.resolution, video.aspect);
        const output = {
          ...size,
          fps: video.fps,
          bitrate: videoBitrate(video.quality, size.width, size.height, video.fps),
        };
        // A missing or unreadable file renders the video without it rather than failing the take.
        const media = <T>(get?: () => Promise<T | null>) => (get ? get().catch(() => null) : Promise.resolve(null));
        const endCard = assets?.endCard;
        const [overlay, music, intro, outro, end] = await Promise.all([
          media(assets?.overlay),
          media(assets?.music),
          media(assets?.intro),
          media(assets?.outro),
          media(endCard ? () => endCard(take) : undefined),
        ]);
        let base = { output, slowMotion: video.slowMotion, reverse: video.reverse, intro, outro, endCard: end };
        let audio = null;
        let beats: number[] = [];
        if (music && video.music) {
          // The soundtrack is mixed to the exact output length before rendering.
          const probe = await probeTake(blob);
          probe.input.dispose();
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
              const roughS = plannedDurationS(base, probe.durationS) + 2;
              const introS = intro ? (intro.kind === 'still' ? intro.seconds : intro.maxSeconds) : 0;
              const onOutput = beatsOnOutput(found.beats, settings, roughS);
              if (video.slowMotion.enabled)
                base = {
                  ...base,
                  slowMotion: {
                    ...video.slowMotion,
                    ...snapSlowMotion(video.slowMotion, onOutput, introS, probe.durationS),
                  },
                };
              beats = beatsOnOutput(found.beats, settings, plannedDurationS(base, probe.durationS));
            }
          }
          audio = await mixSoundtrack(music, video.music, plannedDurationS(base, probe.durationS));
        }
        const job = {
          take: blob,
          ...base,
          overlay,
          audio,
          look: video.filterId ? { id: video.filterId, intensity: 1 } : null,
          effects: video.effects.map((e) => ({ id: e.id, intensity: e.intensity, colorMode: e.colorMode ?? null })),
          beats,
          seed: seedOf(take.id),
        };
        handle.current = client.current.render(take.id, job, (progress) => setCurrent({ takeId: take.id, progress }));
        const result = await handle.current.result;
        const outputId = await putOutput(db, store, {
          takeId: take.id,
          eventId: take.eventId,
          kind: 'mp4',
          blob: result.mp4,
          width: result.width,
          height: result.height,
          durationMs: Math.round(result.durationS * 1000),
          renderMs: result.renderMs,
        });
        // The share page's poster (DL-8): tiny, so it is made now and uploads ahead of the video.
        try {
          const { poster } = await client.current.derive(`${take.id}:poster`, result.mp4, video.fps, {
            poster: true,
            small: false,
          });
          if (poster)
            await putOutput(db, store, {
              takeId: take.id,
              eventId: take.eventId,
              kind: 'poster',
              blob: poster,
              width: result.width,
              height: result.height,
              durationMs: 0,
            });
        } catch (err) {
          console.warn('[render] poster', take.id, err); // the page falls back to the video's first frame
        }
        await db.takes.update(take.id, { status: 'rendered', error: undefined, updatedAt: Date.now() });
        optsRef.current.onRendered?.({ ...take, status: 'rendered' }, outputId);
      } catch (err) {
        const code = err instanceof RenderFailure ? err.code : 'failed';
        // A cancel parks the take as failed so it doesn't restart by itself; Retry re-queues it.
        await db.takes.update(take.id, { status: 'failed', error: code, updatedAt: Date.now() });
        console.warn('[render]', take.id, code, Date.now() - started, 'ms', err);
      } finally {
        handle.current = null;
        setCurrent(null);
      }
    },
    [db],
  );

  /** DL-8 messaging copy for a rendered take: after every waiting render, never ahead of one. */
  const deriveSmall = useCallback(
    async (take: LocalTake) => {
      const { store, video } = optsRef.current;
      if (!store || !client.current) return;
      const main = (await outputsForTake(db, take.id)).find((o) => o.kind === 'mp4');
      if (!main) return;
      try {
        const mp4 = await store.read(main.path, main.mime);
        const { small } = await client.current.derive(`${take.id}:small`, mp4, video.fps, {
          poster: false,
          small: true,
        });
        if (!small) return;
        const size = messagingSize(main.width, main.height);
        await putOutput(db, store, {
          takeId: take.id,
          eventId: take.eventId,
          kind: 'small_mp4',
          blob: small,
          ...size,
          durationMs: main.durationMs,
        });
        optsRef.current.onRendered?.(take, main.id);
      } catch (err) {
        // Not worth retrying in a loop: the full video is there; note it and move on.
        await db.takes.update(take.id, { derivedError: err instanceof Error ? err.message : String(err) });
        console.warn('[render] messaging copy', take.id, err);
      }
    },
    [db],
  );

  /** A rendered take of this event still missing its messaging copy. */
  const nextSmall = useCallback(async (): Promise<LocalTake | undefined> => {
    const { eventId } = optsRef.current;
    const rendered = await db.takes
      .where('[eventId+capturedAt]')
      .between([eventId, 0], [eventId, Infinity])
      .filter((t) => t.status === 'rendered' && !t.derivedError)
      .toArray();
    for (const t of rendered) {
      const kinds = new Set((await outputsForTake(db, t.id)).map((o) => o.kind));
      if (kinds.has('mp4') && !kinds.has('small_mp4')) return t;
    }
    return undefined;
  }, [db]);

  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (;;) {
        // Main-thread prep (reading the take, mixing music) waits too, not just the worker.
        await whenRunning();
        const { eventId, store } = optsRef.current;
        if (!store || !client.current) return;
        const next = await db.takes
          .where('[eventId+capturedAt]')
          .between([eventId, 0], [eventId, Infinity])
          .filter((t) => RENDERABLE.includes(t.status))
          .first();
        if (next) {
          await renderOne(next);
          continue;
        }
        const small = optsRef.current.smallerVersion !== false ? await nextSmall() : undefined;
        if (!small) return;
        await deriveSmall(small);
      }
    } finally {
      busy.current = false;
    }
  }, [db, renderOne, whenRunning, nextSmall, deriveSmall]);

  // Wake whenever the set of renderable takes changes (new take, retry) or storage becomes ready.
  useEffect(() => {
    const sub = liveQuery(() =>
      db.takes
        .where('eventId')
        .equals(opts.eventId)
        .filter((t) => RENDERABLE.includes(t.status))
        .count(),
    ).subscribe({ next: () => void pump(), error: (e) => console.error('[render queue]', e) });
    return () => sub.unsubscribe();
  }, [db, pump, opts.eventId, opts.store]);

  const retry = useCallback(
    (takeId: string) => db.takes.update(takeId, { status: 'recorded', error: undefined, updatedAt: Date.now() }),
    [db],
  );

  const cancel = useCallback(() => handle.current?.cancel(), []);

  return { current, retry, cancel };
}
