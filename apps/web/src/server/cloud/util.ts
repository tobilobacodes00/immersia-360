import { CHUNK_BYTES, Transient, type UploadBody } from './types';

/** Everything the providers need from the outside world, so tests can run them offline and instantly. */
export interface HttpDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const defaultDeps = (): HttpDeps => ({
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
});

export const withDeps = (deps: Partial<HttpDeps> | undefined): HttpDeps => ({ ...defaultDeps(), ...deps });

/**
 * One HTTP call. Network failures and timeouts become Transient, so callers only ever have to
 * reason about typed provider errors. The message never includes the URL or headers (tokens).
 */
export async function send(deps: HttpDeps, url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  try {
    return await deps.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Transient('The provider could not be reached');
  }
}

export async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Narrow an unknown JSON value to an object so fields can be read without `any`. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const DAY_MS = 24 * 3600_000;

/** `Retry-After` is either seconds or an HTTP date. Capped at a day so a bad header can't park a row forever. */
export function retryAfterMs(headers: Headers, now: number): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - now;
  return Number.isFinite(ms) ? Math.min(Math.max(0, ms), DAY_MS) : undefined;
}

/** Wait before resending a part: 0.5 s, 1 s, 2 s … capped at 8 s. */
export const partBackoffMs = (attempt: number) => Math.min(500 * 2 ** attempt, 8_000);

/** How many times one part is resent before the whole upload is given up (the queue retries it later). */
export const PART_RETRIES = 5;

/** URL with a query string, spaces as %20 (some providers do not decode `+` in scope lists). */
export function withQuery(base: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${base}?${query}`;
}

export const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' } as const;
export const formBody = (params: Record<string, string>) => new URLSearchParams(params).toString();

/** A folder or file name both providers accept: no path separators or reserved characters. */
export function sanitizeName(name: string, max = 120): string {
  const cleaned = name
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return ([...cleaned].slice(0, max).join('').trim() || 'Immersia').replace(/[. ]+$/, '');
}

async function* iterate(source: UploadBody): AsyncGenerator<Uint8Array> {
  if (typeof (source as ReadableStream<Uint8Array>).getReader !== 'function') {
    yield* source as AsyncIterable<Uint8Array>;
    return;
  }
  const reader = (source as ReadableStream<Uint8Array>).getReader();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        return;
      }
      if (value) yield value;
    }
  } finally {
    // An upload that gives up must not leave the storage connection open.
    if (finished) reader.releaseLock();
    else await reader.cancel().catch(() => undefined);
  }
}

/**
 * Regroup a stream into parts of exactly `size` bytes (the last one shorter). Pulls from the source
 * only as fast as the consumer takes parts, so at most one part is ever held in memory.
 */
export async function* chunked(
  source: UploadBody,
  size: number = CHUNK_BYTES,
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  let part: Uint8Array<ArrayBuffer> | null = null;
  let filled = 0;
  for await (const piece of iterate(source)) {
    let from = 0;
    while (from < piece.length) {
      part ??= new Uint8Array(size);
      const n = Math.min(size - filled, piece.length - from);
      part.set(piece.subarray(from, from + n), filled);
      filled += n;
      from += n;
      if (filled === size) {
        const full: Uint8Array<ArrayBuffer> = part;
        part = null;
        filled = 0;
        yield full;
      }
    }
  }
  if (part && filled > 0) yield part.subarray(0, filled);
}

/** Read a small body fully (at most `limit` bytes) into one buffer; null when it is longer. */
export async function collect(source: UploadBody, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const out = new Uint8Array(limit);
  let n = 0;
  for await (const piece of iterate(source)) {
    if (n + piece.length > limit) return null;
    out.set(piece, n);
    n += piece.length;
  }
  return out.subarray(0, n);
}
