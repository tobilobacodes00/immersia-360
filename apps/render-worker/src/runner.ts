import type { ServerRenderError, WorkerOutputKind, WorkerOutputTicket } from '@immersia/shared/render';
import type { ClaimedJob, WorkerApi } from './api';

/**
 * One job's life on the worker: hold the lease (heartbeats), fetch the files, render, get upload URLs,
 * upload, finish. Every effect that touches the outside (files, Chrome, storage) is injected, so the
 * decisions here are tested exactly: who reports what, and when a job is simply let go.
 */

/** A failure with the stable code the server stores. */
export class JobError extends Error {
  constructor(
    readonly code: ServerRenderError,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'JobError';
  }
}

/** A file the render produced, on disk. */
export interface OutputFile {
  kind: WorkerOutputKind;
  path: string;
  bytes: number;
  width: number;
  height: number;
  durationMs: number;
}

export interface Rendered {
  outputs: OutputFile[];
  renderMs: number;
}

export interface JobIO {
  /** Make a working directory for the job (and remove it again with `cleanup`). */
  prepare(job: ClaimedJob): Promise<string>;
  cleanup(dir: string): Promise<void>;
  /** Download the job's files into `dir`. Throws JobError (`source_missing`, `download_failed`). */
  download(job: ClaimedJob, dir: string, signal: AbortSignal): Promise<void>;
  /** Render in Chrome. Throws JobError with the render's code. */
  render(job: ClaimedJob, dir: string, signal: AbortSignal, onProgress: (p: number) => void): Promise<Rendered>;
  /** PUT a finished file to its upload URL. Throws JobError('upload_failed'). */
  upload(ticket: WorkerOutputTicket, file: OutputFile, signal: AbortSignal): Promise<void>;
}

export interface RunnerOptions {
  heartbeatMs: number;
  maxRenderMs: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

export type JobResult = 'done' | 'failed' | 'lost';

type Why = 'lease' | 'timeout' | 'shutdown';

/**
 * Run one claimed job to its end. Never throws: whatever happens is reported to the server (a code the
 * server turns into a retry or a failure) or, when the job is no longer ours, quietly dropped.
 * `shutdown` aborts the job from outside (the machine is stopping).
 */
export async function runJob(
  job: ClaimedJob,
  api: WorkerApi,
  io: JobIO,
  opts: RunnerOptions,
  shutdown?: AbortSignal,
  onProgress: (p: number) => void = () => undefined,
): Promise<JobResult> {
  const log = opts.log ?? (() => undefined);
  const abort = new AbortController();
  let why: Why | null = null;
  const stop = (reason: Why) => {
    if (why) return;
    why = reason;
    abort.abort();
  };
  const onShutdown = () => stop('shutdown');
  if (shutdown?.aborted) stop('shutdown');
  shutdown?.addEventListener('abort', onShutdown, { once: true });

  // The lease: extended while we work; if the server says the job is no longer ours (its lease ran out,
  // it hit the time limit, the guest erased their session), stop at once and say nothing more.
  const beat = setInterval(() => {
    api
      .heartbeat(job.id, job.claimToken)
      .then((r) => {
        if (r !== 'ok') stop('lease');
      })
      // A missed beat is not a lost lease: the next one tries again, and the lease has slack.
      .catch((err: unknown) => log('heartbeat failed', { error: String(err) }));
  }, opts.heartbeatMs);
  const limit = setTimeout(() => stop('timeout'), opts.maxRenderMs);

  let dir: string | null = null;
  try {
    dir = await io.prepare(job);
    abort.signal.throwIfAborted();
    await io.download(job, dir, abort.signal);
    abort.signal.throwIfAborted();
    const rendered = await io.render(job, dir, abort.signal, onProgress);
    abort.signal.throwIfAborted();

    const tickets = await api.registerOutputs(
      job.id,
      job.claimToken,
      rendered.outputs.map(({ kind, bytes, width, height, durationMs }) => ({
        kind,
        bytes,
        width,
        height,
        durationMs,
      })),
    );
    if (tickets === 'lease_lost') {
      stop('lease');
      return 'lost';
    }
    // The poster first (a guest's page shows it before the video loads), then the lighter copy, then the video.
    const order: Record<WorkerOutputKind, number> = { poster: 0, small_mp4: 1, mp4: 2 };
    for (const file of [...rendered.outputs].sort((a, b) => order[a.kind] - order[b.kind])) {
      const ticket = tickets.find((t) => t.kind === file.kind);
      if (!ticket) throw new JobError('upload_failed', `no upload URL for ${file.kind}`);
      await io.upload(ticket, file, abort.signal);
    }
    const done = await api.complete(job.id, job.claimToken, rendered.renderMs);
    if (done === 'ok') return 'done';
    if (done === 'lease_lost') {
      stop('lease');
      return 'lost';
    }
    throw new JobError('upload_failed', 'the server did not find the uploaded files');
  } catch (err) {
    // Decide the code from why we stopped, then from what threw.
    const stopped = why as Why | null;
    if (stopped === 'lease') {
      log('job no longer ours, dropped', { job: job.id });
      return 'lost';
    }
    const code: ServerRenderError =
      stopped === 'timeout'
        ? 'timeout'
        : stopped === 'shutdown'
          ? 'shutdown'
          : err instanceof JobError
            ? err.code
            : 'failed';
    log('job failed', { job: job.id, code, error: err instanceof Error ? err.message : String(err) });
    const held = await api.fail(job.id, job.claimToken, code).catch((e: unknown) => {
      log('could not report the failure', { error: String(e) });
      return true;
    });
    return held ? 'failed' : 'lost';
  } finally {
    clearInterval(beat);
    clearTimeout(limit);
    shutdown?.removeEventListener('abort', onShutdown);
    if (dir) await io.cleanup(dir).catch((e: unknown) => log('cleanup failed', { error: String(e) }));
  }
}

// ---------------------------------------------------------------------------------------------
// The loop

export interface LoopOptions {
  pollMs: number;
  /** null: never exit when idle. */
  idleExitMs: number | null;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

/** True when a worker that last had work at `lastWork` should now exit (scale to zero). */
export function shouldExit(lastWork: number, now: number, idleExitMs: number | null): boolean {
  return idleExitMs !== null && now - lastWork >= idleExitMs;
}

/** Sleep that ends early on abort. */
export const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

/**
 * Claim, run, repeat. Exits when told to (`stop`), or after `idleExitMs` with nothing to do: the Fly
 * machine then stops, and the web app starts it again when the next job is queued. A claim that fails
 * (the web app is down) is treated like an empty queue, so a worker outlives a short outage.
 */
export async function workLoop(
  api: WorkerApi,
  io: JobIO,
  runner: RunnerOptions,
  loop: LoopOptions,
  stop: AbortSignal,
  onProgress?: (p: number) => void,
): Promise<'idle' | 'stopped'> {
  const now = loop.now ?? Date.now;
  const sleep = loop.sleep ?? abortableSleep;
  const log = loop.log ?? (() => undefined);
  let lastWork = now();
  while (!stop.aborted) {
    let job: ClaimedJob | null = null;
    try {
      job = await api.claim();
    } catch (err) {
      log('claim failed', { error: String(err) });
    }
    if (job) {
      const result = await runJob(job, api, io, runner, stop, onProgress);
      log('job finished', { job: job.id, result });
      lastWork = now();
      continue;
    }
    if (shouldExit(lastWork, now(), loop.idleExitMs)) return 'idle';
    await sleep(loop.pollMs, stop);
  }
  return 'stopped';
}
