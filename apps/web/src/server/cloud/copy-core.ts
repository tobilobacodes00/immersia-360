import {
  Permanent,
  QuotaExceeded,
  ReauthRequired,
  Transient,
  type CloudFile,
  type CloudProvider,
  type UploadBody,
} from './types';

/**
 * The decisions behind the cloud copy queue (SHR-7), kept free of the database and of storage so
 * they can be tested exactly: how to copy one file without ever duplicating it, and what to do
 * with the row when it fails.
 */

/** Tries before a row is given up on (backoff 30 s … ~1 h: about two hours in all). */
export const MAX_ATTEMPTS = 8;
/** How long a claim lasts; longer than any serverless function can run, so a live worker never loses its row. */
export const LEASE_MS = 30 * 60_000;

/** 30 s, 1 min, 2 min … capped at 6 h. `attempts` counts the try that just failed. */
export const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 6 * 3600_000);

export interface CopySource {
  body: UploadBody;
  size: number;
}

export interface CopyRequest {
  token: string;
  /** The event's folder in the operator's cloud. */
  folderId: string;
  filename: string;
  mime: string;
}

/**
 * Copy one file, at most once. The name is the identity: if the folder already holds a file by that
 * name (a previous attempt that died after the provider finished but before we wrote it down, or a
 * disconnect/reconnect in between), that file is the result and nothing is uploaded again.
 */
export async function copyToCloud(
  provider: CloudProvider,
  req: CopyRequest,
  openSource: () => Promise<CopySource>,
): Promise<{ file: CloudFile; reused: boolean }> {
  const existing = await provider.findExisting(req.token, req.folderId, req.filename);
  if (existing) return { file: existing, reused: true };
  const source = await openSource();
  try {
    const file = await provider.upload(req.token, req.folderId, req.filename, req.mime, source.size, source.body);
    return { file, reused: false };
  } finally {
    // An upload that failed part-way must not hold the storage connection open.
    if (typeof (source.body as ReadableStream).cancel === 'function')
      await (source.body as ReadableStream).cancel().catch(() => undefined);
  }
}

export type Decision =
  /** Back to the queue, to be tried again at `at`. */
  | { kind: 'retry'; code: string; at: Date }
  /** The cloud no longer accepts our access: the row waits, the integration asks the operator to reconnect. */
  | { kind: 'reauth'; code: 'reauth_required' }
  /** Nothing we can retry will fix this; it needs the operator (or can never work). */
  | { kind: 'fail'; code: string };

/** What to do with a row after an attempt failed. `attempts` includes the attempt that just failed. */
export function decideFailure(err: unknown, attempts: number, now: Date): Decision {
  if (err instanceof ReauthRequired) return { kind: 'reauth', code: 'reauth_required' };
  if (err instanceof QuotaExceeded) return { kind: 'fail', code: 'quota_exceeded' };
  if (err instanceof Permanent) return { kind: 'fail', code: err.code };
  // Transient trouble, and anything unexpected (a database blip, a storage hiccup): try again later.
  const code = err instanceof Transient ? 'transient' : 'unknown';
  if (attempts >= MAX_ATTEMPTS) return { kind: 'fail', code };
  const asked = err instanceof Transient ? (err.retryAfterMs ?? 0) : 0;
  return { kind: 'retry', code, at: new Date(now.getTime() + Math.max(backoffMs(attempts), asked)) };
}

/** The wording to show for a stored `last_error` code (keys of studio.integrations.errors). */
export type CopyErrorKey =
  | 'reauth_required'
  | 'quota_exceeded'
  | 'transient'
  | 'folder_missing'
  | 'folder_inaccessible'
  | 'source_gone'
  | 'other';

const KNOWN: readonly CopyErrorKey[] = [
  'reauth_required',
  'quota_exceeded',
  'transient',
  'folder_missing',
  'folder_inaccessible',
  'source_gone',
];

export const copyErrorKey = (code: string | null): CopyErrorKey | null =>
  code === null ? null : (KNOWN as readonly string[]).includes(code) ? (code as CopyErrorKey) : 'other';
