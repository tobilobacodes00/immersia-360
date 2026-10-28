import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { WorkerOutputTicket } from '@immersia/shared/render';
import type { ClaimedJob } from './api';
import { JobError, type JobIO, type OutputFile } from './runner';

/** The names a job's files have in its working directory (and in the local file server's URLs). */
export const JOB_FILES = ['original', 'overlay', 'end_card', 'intro', 'outro', 'music', 'background'] as const;
export type JobFile = (typeof JOB_FILES)[number];

/** Which URL in the claim feeds which file. */
export const urlOf = (job: ClaimedJob): Record<JobFile, string | null> => ({
  original: job.urls.original,
  overlay: job.urls.overlay,
  end_card: job.urls.endCard,
  intro: job.urls.intro,
  outro: job.urls.outro,
  music: job.urls.music,
  background: job.urls.background,
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A download that ended in an HTTP status. */
export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusError';
  }
}

/** Statuses a second try can not change: the object is not there, or the link is not allowed. */
const final = (status: number) => status >= 400 && status < 500 && status !== 408 && status !== 429;

async function downloadOnce(url: string, dest: string, signal: AbortSignal, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, { signal });
  if (!res.ok || !res.body) throw new HttpStatusError(res.status);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest), {
    signal,
  });
}

/**
 * GET `url` into `dest`, streamed (a recording is never held in memory), with a few tries for network
 * trouble and 5xx. Throws HttpStatusError for a final answer, the last error otherwise.
 */
export async function download(
  url: string,
  dest: string,
  signal: AbortSignal,
  opts: { fetchImpl?: typeof fetch; retryDelayMs?: number } = {},
): Promise<number> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep((opts.retryDelayMs ?? 1_000) * 3 ** (attempt - 1));
    signal.throwIfAborted();
    try {
      await downloadOnce(url, dest, signal, fetchImpl);
      return (await stat(dest)).size;
    } catch (err) {
      if (signal.aborted) throw err;
      if (err instanceof HttpStatusError && final(err.status)) throw err;
      last = err;
    }
  }
  throw last;
}

/**
 * PUT a file to a presigned URL. The exact length and type are signed, so both are sent exactly. Done
 * with node:http(s) rather than fetch so the length is a real Content-Length and the file streams from
 * disk. Retries network trouble and 5xx; a 4xx (an expired or mismatched signature) is final.
 */
export async function putFile(
  ticket: WorkerOutputTicket,
  file: { path: string; bytes: number },
  signal: AbortSignal,
  opts: { retryDelayMs?: number } = {},
): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep((opts.retryDelayMs ?? 1_000) * 3 ** (attempt - 1));
    signal.throwIfAborted();
    try {
      const status = await putOnce(ticket, file, signal);
      if (status >= 200 && status < 300) return;
      last = new HttpStatusError(status);
      if (final(status)) break;
    } catch (err) {
      if (signal.aborted) throw err;
      last = err;
    }
  }
  throw last;
}

function putOnce(
  ticket: WorkerOutputTicket,
  file: { path: string; bytes: number },
  signal: AbortSignal,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const url = new URL(ticket.url);
    const request = (url.protocol === 'https:' ? https : http).request(
      url,
      {
        method: ticket.method,
        headers: { ...ticket.headers, 'content-length': String(file.bytes) },
        signal,
        // A stalled connection is dropped after a minute without a byte.
        timeout: 60_000,
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
        res.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error('upload timed out')));
    request.on('error', reject);
    createReadStream(file.path).on('error', reject).pipe(request);
  });
}

// ---------------------------------------------------------------------------------------------
// JobIO (the files half)

/** Which files a job must have, and which may be missing (a booth renders without them too). */
const REQUIRED: readonly JobFile[] = ['original'];

/** The file-handling half of the runner's IO. Chrome (rendering) is added by the caller. */
export function fileIO(
  workDir: string,
  opts: { fetchImpl?: typeof fetch; retryDelayMs?: number } = {},
): Pick<JobIO, 'prepare' | 'cleanup' | 'download' | 'upload'> {
  return {
    async prepare() {
      await mkdir(workDir, { recursive: true });
      return mkdtemp(join(workDir, 'job-'));
    },
    cleanup: (dir) => rm(dir, { recursive: true, force: true }),
    async download(job, dir, signal) {
      const urls = urlOf(job);
      for (const name of JOB_FILES) {
        const url = urls[name];
        if (!url) {
          if (REQUIRED.includes(name)) throw new JobError('source_missing', `no link for ${name}`);
          continue;
        }
        try {
          await download(url, join(dir, name), signal, opts);
        } catch (err) {
          if (signal.aborted) throw err;
          const status = err instanceof HttpStatusError ? err.status : 0;
          // A file that is gone: the recording means the job can not run; anything else is rendered without.
          if (status === 404 || status === 410) {
            if (REQUIRED.includes(name)) throw new JobError('source_missing', `${name} is gone`);
            await rm(join(dir, name), { force: true });
            continue;
          }
          throw new JobError('download_failed', `${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },
    async upload(ticket, file: OutputFile, signal) {
      try {
        await putFile(ticket, file, signal, opts);
      } catch (err) {
        if (signal.aborted) throw err;
        throw new JobError('upload_failed', `${file.kind}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
