'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { RenderClient, RenderFailure, type RenderHandle } from '@immersia/render-engine/client';
import { mixSoundtrack } from '@immersia/render-engine/audio';
import { outputSize, plannedDurationS, probeTake, videoBitrate } from '@immersia/render-engine';
import { boothDb, putOutput, type LocalTake, type TakeStore } from '@immersia/offline';
import type { Video360Settings } from '@immersia/shared';
import { workerUrl } from '@/lib/workers';

/** Takes waiting to render. */
export const RENDERABLE: LocalTake['status'][] = ['recorded', 'interrupted', 'imported'];

export interface RenderAssets {
  overlay?: () => Promise<ImageBitmap | null>;
  music?: () => Promise<Blob | null>;
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
        const base = { output, slowMotion: video.slowMotion, reverse: video.reverse };
        const [overlay, music] = await Promise.all([assets?.overlay?.() ?? null, assets?.music?.() ?? null]);
        let audio = null;
        if (music && video.music) {
          // The soundtrack is mixed to the exact output length before rendering.
          const probe = await probeTake(blob);
          probe.input.dispose();
          audio = await mixSoundtrack(music, video.music, plannedDurationS(base, probe.durationS));
        }
        handle.current = client.current.render(take.id, { take: blob, ...base, overlay, audio }, (progress) =>
          setCurrent({ takeId: take.id, progress }),
        );
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
        if (!next) return;
        await renderOne(next);
      }
    } finally {
      busy.current = false;
    }
  }, [db, renderOne, whenRunning]);

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
