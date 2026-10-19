/// <reference lib="webworker" />
/**
 * The render worker: decoding, WebGL compositing and encoding all happen here, off the main thread,
 * so the booth UI stays responsive and the operator can keep recording (VID-9).
 */
import { encodeClip, messagingCopy, posterFrame } from './derive';
import { RenderError, render, type RenderJob } from './render';

export {};
declare const self: DedicatedWorkerGlobalScope;

export type WorkerMessage =
  | { type: 'render'; id: string; job: RenderJob }
  /** Poster and (optionally) the messaging copy of a finished render (DL-8). */
  | { type: 'derive'; id: string; mp4: Blob; fps: number; poster: boolean; small: boolean }
  /** A short MP4 from photo-booth motion frames (PHO-2). The bitmaps are transferred. */
  | { type: 'clip'; id: string; frames: ImageBitmap[]; fps: number; pingPong: boolean }
  | { type: 'cancel'; id: string }
  | { type: 'pause' }
  | { type: 'resume' };

export type WorkerReply =
  | { type: 'progress'; id: string; progress: number }
  | { type: 'done'; id: string; result: Awaited<ReturnType<typeof render>> }
  | { type: 'derived'; id: string; poster: Blob | null; small: Blob | null }
  | { type: 'clipped'; id: string; mp4: Blob }
  | { type: 'error'; id: string; code: RenderError['code']; message: string };

const running = new Map<string, AbortController>();

// Pause gate: the render awaits it between frames. A cancel also releases it, so a paused render
// can still be cancelled (it then stops at its next abort check).
let paused = false;
const waiting: (() => void)[] = [];
const release = () => {
  for (const go of waiting.splice(0)) go();
};
const gate = () => (paused ? new Promise<void>((go) => waiting.push(go)) : Promise.resolve());

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;
  if (msg.type === 'pause') {
    paused = true;
    return;
  }
  if (msg.type === 'resume') {
    paused = false;
    release();
    return;
  }
  if (msg.type === 'cancel') {
    running.get(msg.id)?.abort();
    release();
    return;
  }
  if (msg.type === 'clip') {
    try {
      const mp4 = await encodeClip(msg.frames, msg.fps, { pingPong: msg.pingPong });
      self.postMessage({ type: 'clipped', id: msg.id, mp4 } satisfies WorkerReply);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'error', id: msg.id, code: 'failed', message } satisfies WorkerReply);
    }
    return;
  }
  if (msg.type === 'derive') {
    try {
      const poster = msg.poster ? await posterFrame(msg.mp4) : null;
      const small = msg.small ? await messagingCopy(msg.mp4, msg.fps) : null;
      self.postMessage({ type: 'derived', id: msg.id, poster, small } satisfies WorkerReply);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'error', id: msg.id, code: 'failed', message } satisfies WorkerReply);
    }
    return;
  }
  const controller = new AbortController();
  running.set(msg.id, controller);
  try {
    const result = await render(msg.job, {
      gate,
      signal: controller.signal,
      onProgress: (progress) => self.postMessage({ type: 'progress', id: msg.id, progress } satisfies WorkerReply),
    });
    self.postMessage({ type: 'done', id: msg.id, result } satisfies WorkerReply);
  } catch (err) {
    const e2 =
      err instanceof RenderError ? err : new RenderError('failed', err instanceof Error ? err.message : String(err));
    self.postMessage({ type: 'error', id: msg.id, code: e2.code, message: e2.message } satisfies WorkerReply);
  } finally {
    running.delete(msg.id);
    msg.job.overlay?.close();
    if (msg.job.intro?.kind === 'still') msg.job.intro.image.close();
    if (msg.job.outro?.kind === 'still') msg.job.outro.image.close();
    msg.job.endCard?.image.close();
  }
};
