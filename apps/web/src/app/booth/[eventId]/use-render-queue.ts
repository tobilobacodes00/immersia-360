'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { RenderClient, RenderFailure, type RenderHandle } from '@immersia/render-engine/client';
import { mixSoundtrack } from '@immersia/render-engine/audio';
import {
  messagingSize,
  outputSize,
  plannedDurationS,
  parseMemory,
  recordSuccess,
  startRung,
  videoBitrate,
  type Card,
  type RenderBackground,
  type RungMemory,
  type StillCard,
} from '@immersia/render-engine';
import {
  boothDb,
  outputsForTake,
  putOutput,
  type BoothDB,
  type LocalTake,
  type RenderRung,
  type TakeStore,
} from '@immersia/offline';
import type { EventFrom, Video360Settings } from '@immersia/shared';
import { workerUrl } from '@/lib/workers';
import { availability, warmWasmEncoder } from './device-ladder';
import { codeOfFailure, runLadder } from './ladder-run';
import { cardSecondsOf, planTiming, seedOf } from './render-plan';
import { renderCompleted, renderFailed } from './render-events';
import { createServerRenderApi, reportRenderPath, serverStepDeps } from './server-render';
import { boothBrowser } from './use-booth-analytics';
import {
  FAILED_RECHECK_MS,
  recheckOf,
  serverStep,
  watchesServer,
  type CardPlan,
  type RecipePlan,
  type ServerProgress,
} from './server-render-core';

/** Takes waiting to render. */
export const RENDERABLE: LocalTake['status'][] = ['recorded', 'interrupted', 'imported'];

/** The event's media for each render. Called per job: the worker takes ownership of what it is sent. */
export interface RenderAssets {
  overlay?: () => Promise<ImageBitmap | null>;
  music?: () => Promise<Blob | null>;
  intro?: () => Promise<Card | null>;
  outro?: () => Promise<Card | null>;
  /** CAP-10: what replaces the background behind the guest. Null renders as filmed. */
  background?: () => Promise<RenderBackground | null>;
  /** DL-4: the closing QR card for this take's guest session. */
  endCard?: (take: LocalTake) => Promise<StillCard | null>;
  /** What a server render is told about the event's library assets (it fetches them itself). */
  describe?: () => { intro: CardPlan | null; outro: CardPlan | null; background: RecipePlan['background'] };
}

export interface RenderState {
  takeId: string;
  progress: number;
  /** The rung of the render ladder this render is running on. */
  path: RenderRung;
}

/** The render ladder's memory for this device (which rung worked, which failed and when). */
const MEMORY_KEY = 'render-rungs.v1';

const loadMemory = async (db: BoothDB): Promise<RungMemory> => parseMemory((await db.kv.get(MEMORY_KEY))?.value);
const saveMemory = (db: BoothDB, memory: RungMemory) => db.kv.put({ key: MEMORY_KEY, value: memory });

/** Set by the E2E tests (and only honoured when the server says it runs in test mode): rungs to fail on purpose. */
const FORCE_FAIL_KEY = 'immersia.e2e.render-fail';

function forcedRungs(): RenderRung[] {
  try {
    return (localStorage.getItem(FORCE_FAIL_KEY) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is RenderRung => s === 'local' || s === 'wasm' || s === 'server');
  } catch {
    return [];
  }
}

/**
 * The booth's background render queue (VID-9): renders each finished take in the render worker,
 * oldest first, one at a time, while the operator keeps recording.
 *
 * Every take walks the render ladder (`local` → `wasm` → `server`): it starts on the best rung this
 * device can use, and a render that fails for a codec or encoder reason moves to the next rung instead of
 * failing the take. The rung that worked is remembered for the device, and one that failed for a
 * device-level reason is skipped by later takes for a while. A take handed to the server stays on the
 * device as `server` until the server's worker has its video in the guest's session.
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
  /** This booth's device token: for the server rung and for telling the server how renders went. */
  token?: string | null;
  /** The server has a render worker (the third rung exists). */
  serverRender?: boolean;
  /** The server runs in E2E test mode: the tests may force rungs to fail. Never true in production. */
  testHooks?: boolean;
  /** `outputId` is null when the video is not on this device (rendered by the server). */
  onRendered?: (take: LocalTake, outputId: string | null) => void;
  /** Analytics: `render_completed` and `render_failed`, with the rung of the ladder (`path`) that did the work. */
  onTrack?: (event: EventFrom<'device'>) => void;
}) {
  const db = boothDb();
  const [current, setCurrent] = useState<RenderState | null>(null);
  const client = useRef<RenderClient | null>(null);
  const handle = useRef<RenderHandle | null>(null);
  const busy = useRef(false);
  const serverBusy = useRef(false);
  const serverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wakeServer = useRef<() => void>(() => undefined);
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

  const serverRender = Boolean(opts.serverRender);
  useEffect(() => {
    void warmWasmEncoder(serverRender);
  }, [serverRender]);

  /** One attempt on this device, with the browser's encoder (`local`) or the WebAssembly one (`wasm`). */
  const renderLocal = useCallback(
    async (take: LocalTake, rung: 'local' | 'wasm') => {
      const { video, assets, store } = optsRef.current;
      if (!store || !client.current) throw new RenderFailure('failed', 'The booth is not ready');
      setCurrent({ takeId: take.id, progress: 0, path: rung });
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
      const [overlay, music, intro, outro, end, background] = await Promise.all([
        media(assets?.overlay),
        media(assets?.music),
        media(assets?.intro),
        media(assets?.outro),
        media(endCard ? () => endCard(take) : undefined),
        media(assets?.background),
      ]);
      const timing = await planTiming({
        video,
        take: blob,
        music,
        output,
        cards: { intro: cardSecondsOf(intro), outro: cardSecondsOf(outro), end: cardSecondsOf(end) },
      });
      const base = {
        output,
        slowMotion: timing.slowMotion,
        reverse: video.reverse,
        intro,
        outro,
        endCard: end,
      };
      // The soundtrack is mixed to the exact output length before rendering.
      const audio =
        music && video.music && timing.takeDurationS !== null
          ? await mixSoundtrack(music, video.music, plannedDurationS(base, timing.takeDurationS))
          : null;
      const job = {
        take: blob,
        ...base,
        overlay,
        audio,
        look: video.filterId ? { id: video.filterId, intensity: 1 } : null,
        effects: video.effects.map((e) => ({ id: e.id, intensity: e.intensity, colorMode: e.colorMode ?? null })),
        beats: timing.beats,
        seed: seedOf(take.id),
        background,
      };
      handle.current = client.current.render(
        take.id,
        job,
        (progress) => setCurrent({ takeId: take.id, progress, path: rung }),
        rung === 'wasm' ? 'wasm' : 'native',
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
      return { outputId, renderMs: result.renderMs };
    },
    [db],
  );

  const renderOne = useCallback(
    async (take: LocalTake) => {
      const { video, store, token, testHooks } = optsRef.current;
      if (!store || !client.current) return;
      await db.takes.update(take.id, { status: 'rendering', updatedAt: Date.now() });
      setCurrent({ takeId: take.id, progress: 0, path: 'local' });
      const started = Date.now();
      try {
        const outcome = await runLadder({
          available: await availability(Boolean(optsRef.current.serverRender)),
          memory: await loadMemory(db),
          now: Date.now(),
          forced: testHooks ? forcedRungs() : undefined,
          attempt: (rung) => renderLocal(take, rung),
          // Handing over costs nothing: the server step (upload, queue, poll) runs on its own schedule.
          toServer: async () => {
            await db.takes.update(take.id, {
              status: 'server',
              renderPath: 'server',
              serverJobId: undefined,
              serverCheckAt: Date.now(),
              serverAttempts: 0,
              error: undefined,
              updatedAt: Date.now(),
            });
          },
        });
        await saveMemory(db, outcome.memory);
        if (outcome.kind === 'rendered') {
          await db.takes.update(take.id, {
            status: 'rendered',
            renderPath: outcome.rung,
            error: undefined,
            updatedAt: Date.now(),
          });
          optsRef.current.onRendered?.({ ...take, status: 'rendered' }, outcome.result.outputId);
          optsRef.current.onTrack?.(
            renderCompleted({ take, video, path: outcome.rung, renderMs: outcome.result.renderMs, now: Date.now() }),
          );
          reportRenderPath(token ?? null, outcome.rung);
        } else if (outcome.kind === 'server') {
          wakeServer.current();
        } else {
          // A cancel parks the take as failed so it doesn't restart by itself; Retry re-queues it.
          await db.takes.update(take.id, { status: 'failed', error: outcome.code, updatedAt: Date.now() });
          console.warn('[render]', take.id, outcome.code, Date.now() - started, 'ms');
          const failed = renderFailed({ code: outcome.code, path: outcome.rung ?? 'local', browser: boothBrowser() });
          if (failed) optsRef.current.onTrack?.(failed);
        }
      } catch (err) {
        // The ladder itself never throws; this is the device database or the like giving way.
        const code = codeOfFailure(err);
        await db.takes.update(take.id, { status: 'failed', error: code, updatedAt: Date.now() });
        console.warn('[render]', take.id, code, Date.now() - started, 'ms', err);
      } finally {
        handle.current = null;
        setCurrent(null);
      }
    },
    [db, renderLocal],
  );

  /** DL-8 messaging copy for a rendered take: after every waiting render, never ahead of one. */
  const deriveSmall = useCallback(
    async (take: LocalTake) => {
      const { store, video, serverRender: hasServer } = optsRef.current;
      if (!store || !client.current) return;
      const main = (await outputsForTake(db, take.id)).find((o) => o.kind === 'mp4');
      if (!main) return;
      try {
        // The copy is a transcode: it needs an encoder on this device, the browser's or the WebAssembly one.
        const rung = startRung(await availability(Boolean(hasServer)), await loadMemory(db), Date.now());
        if (rung !== 'local' && rung !== 'wasm') throw new Error('no encoder on this device');
        const mp4 = await store.read(main.path, main.mime);
        const { small } = await client.current.derive(
          `${take.id}:small`,
          mp4,
          video.fps,
          { poster: false, small: true },
          rung === 'wasm' ? 'wasm' : 'native',
        );
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

  // ---------------------------------------------------------------------------------------------
  // The server rung: takes waiting on the render worker. Network work only (no GPU), so it runs beside the
  // local renders instead of behind them.

  const serverOne = useCallback(
    async (take: LocalTake) => {
      const { token, store, video, assets, smallerVersion } = optsRef.current;
      if (!token || !store) return;
      const now = Date.now();
      const api = createServerRenderApi(token);
      const rendered = async (patch: ServerProgress, renderMs: number | null) => {
        await db.takes.update(take.id, {
          ...patch,
          status: 'rendered',
          renderPath: 'server',
          error: undefined,
          serverCheckAt: undefined,
          updatedAt: now,
        });
        await saveMemory(db, recordSuccess(await loadMemory(db), 'server'));
        optsRef.current.onRendered?.({ ...take, status: 'rendered' }, null);
        optsRef.current.onTrack?.(renderCompleted({ take, video, path: 'server', renderMs: renderMs ?? 0, now }));
        reportRenderPath(token, 'server');
      };

      if (take.status === 'failed') {
        // Failed on the server and looked at again now and then: the operator may have started it again.
        const job = await api.job(take.id).catch(() => null);
        const seen = recheckOf(job, now);
        if (seen.kind === 'rendered') await rendered(seen.patch, seen.renderMs);
        else if (seen.kind === 'wait')
          await db.takes.update(take.id, { ...seen.patch, status: 'server', error: undefined, updatedAt: now });
        else await db.takes.update(take.id, { ...seen.patch, updatedAt: now });
        return;
      }

      const step = await serverStep(
        take,
        serverStepDeps({
          take,
          api,
          video,
          store,
          assets,
          smallerVersion: smallerVersion !== false,
        }),
        now,
      );
      if (step.kind === 'wait') {
        await db.takes.update(take.id, { ...step.patch, updatedAt: now });
      } else if (step.kind === 'rendered') {
        await rendered(step.patch, step.renderMs);
      } else {
        await db.takes.update(take.id, {
          ...step.patch,
          status: 'failed',
          error: step.error,
          // A job that failed is looked at again later (an operator can start it again); a take the
          // booth itself gave up on has no job to look at.
          serverCheckAt: step.patch.serverJobId ? now + FAILED_RECHECK_MS : undefined,
          updatedAt: now,
        });
        const failed = renderFailed({ code: step.error, path: 'server', browser: boothBrowser() });
        if (failed) optsRef.current.onTrack?.(failed);
      }
    },
    [db],
  );

  const pumpServer = useCallback(async () => {
    if (serverBusy.current) return;
    serverBusy.current = true;
    try {
      for (;;) {
        const { eventId, token, store } = optsRef.current;
        if (!token || !store || !navigator.onLine) return;
        const waiting = await db.takes
          .where('[eventId+capturedAt]')
          .between([eventId, 0], [eventId, Infinity])
          .filter(watchesServer)
          .toArray();
        const due = waiting.find((t) => (t.serverCheckAt ?? 0) <= Date.now());
        if (!due) {
          // Nothing due: wake up when the next take is.
          clearTimeout(serverTimer.current);
          const next = Math.min(...waiting.map((t) => t.serverCheckAt ?? 0));
          if (waiting.length)
            serverTimer.current = setTimeout(() => wakeServer.current(), Math.max(1_000, next - Date.now()));
          return;
        }
        await serverOne(due);
      }
    } finally {
      serverBusy.current = false;
    }
  }, [db, serverOne]);

  useEffect(() => {
    wakeServer.current = () => void pumpServer();
    return () => {
      wakeServer.current = () => undefined;
    };
  }, [pumpServer]);

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

  // Takes on the server: when one arrives, when storage or the token is ready, and when the connection returns.
  useEffect(() => {
    const sub = liveQuery(() => db.takes.where('eventId').equals(opts.eventId).filter(watchesServer).count()).subscribe(
      { next: () => wakeServer.current(), error: (e) => console.error('[render queue]', e) },
    );
    const online = () => wakeServer.current();
    window.addEventListener('online', online);
    wakeServer.current();
    return () => {
      sub.unsubscribe();
      window.removeEventListener('online', online);
      clearTimeout(serverTimer.current);
    };
  }, [db, opts.eventId, opts.store, opts.token]);

  const retry = useCallback(
    (takeId: string) =>
      db.takes.update(takeId, {
        status: 'recorded',
        error: undefined,
        // A fresh walk down the ladder: nothing of an earlier server attempt carries over.
        serverJobId: undefined,
        serverCheckAt: undefined,
        serverAttempts: undefined,
        serverStripped: undefined,
        updatedAt: Date.now(),
      }),
    [db],
  );

  const cancel = useCallback(() => handle.current?.cancel(), []);

  return { current, retry, cancel };
}
