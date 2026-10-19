import type { RenderJob, RenderResult } from './render';
import type { WorkerMessage, WorkerReply } from './render.worker';

export interface RenderHandle {
  id: string;
  result: Promise<RenderResult>;
  cancel: () => void;
}

export class RenderFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RenderFailure';
  }
}

/**
 * Main-thread side of the render worker. One worker, one render at a time (a booth device has one
 * GPU; parallel renders would only fight over it); further jobs wait in order (VID-9 queue).
 */
export class RenderClient {
  private worker: Worker | null = null;
  private pending = new Map<
    string,
    { resolve: (r: RenderResult) => void; reject: (e: Error) => void; onProgress?: (p: number) => void }
  >();
  private chain: Promise<unknown> = Promise.resolve();
  private paused = false;

  constructor(private readonly createWorker: () => Worker) {}

  /** Park the render in progress between frames (and any that starts) until `resume()`. */
  pause() {
    this.paused = true;
    this.worker?.postMessage({ type: 'pause' } satisfies WorkerMessage);
  }

  resume() {
    this.paused = false;
    this.worker?.postMessage({ type: 'resume' } satisfies WorkerMessage);
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = this.createWorker();
    if (this.paused) w.postMessage({ type: 'pause' } satisfies WorkerMessage);
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') p.onProgress?.(m.progress);
      else {
        this.pending.delete(m.id);
        if (m.type === 'done') p.resolve(m.result);
        else p.reject(new RenderFailure(m.code, m.message));
      }
    };
    w.onerror = (e) => {
      // A crashed worker fails everything in flight; the next job gets a fresh worker.
      for (const p of this.pending.values())
        p.reject(new RenderFailure('failed', e.message || 'Render worker crashed'));
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }

  render(id: string, job: RenderJob, onProgress?: (p: number) => void): RenderHandle {
    let cancelled = false;
    const result = new Promise<RenderResult>((resolve, reject) => {
      this.chain = this.chain
        .catch(() => undefined)
        .then(
          () =>
            new Promise<void>((done) => {
              if (cancelled) {
                reject(new RenderFailure('cancelled', 'Render cancelled'));
                return done();
              }
              this.pending.set(id, {
                resolve: (r) => {
                  resolve(r);
                  done();
                },
                reject: (e) => {
                  reject(e);
                  done();
                },
                onProgress,
              });
              const transfer: Transferable[] = [];
              if (job.overlay) transfer.push(job.overlay);
              if (job.intro?.kind === 'still') transfer.push(job.intro.image);
              if (job.outro?.kind === 'still') transfer.push(job.outro.image);
              if (job.endCard) transfer.push(job.endCard.image);
              for (const ch of job.audio?.channels ?? []) transfer.push(ch.buffer);
              this.ensure().postMessage({ type: 'render', id, job } satisfies WorkerMessage, transfer);
            }),
        );
    });
    return {
      id,
      result,
      cancel: () => {
        cancelled = true;
        this.worker?.postMessage({ type: 'cancel', id } satisfies WorkerMessage);
      },
    };
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new RenderFailure('cancelled', 'Renderer closed'));
    this.pending.clear();
  }
}

/** Created with the static form so every bundler emits the worker as its own chunk. */
export function createRenderWorker(): Worker {
  // No `name` option: Turbopack's worker runtime uses that channel for its own bootstrap config.
  return new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
}
