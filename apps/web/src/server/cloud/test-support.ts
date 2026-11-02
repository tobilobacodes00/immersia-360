/** Helpers for the provider tests: a recording fake `fetch` and a lazy synthetic stream. Not shipped. */
import type { HttpDeps } from './util';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  /** Request body size in bytes (the bytes themselves are not kept: some tests send 200 MB). */
  bytes: number;
  /** The body when it was text. */
  text: string | undefined;
}

export type Handler = (call: RecordedCall) => Response | Promise<Response>;

export function mockFetch(handler: Handler) {
  const calls: RecordedCall[] = [];
  const fetch: HttpDeps['fetch'] = async (input, init) => {
    const body = init?.body;
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      bytes: typeof body === 'string' ? Buffer.byteLength(body) : body ? (body as Uint8Array).byteLength : 0,
      text: typeof body === 'string' ? body : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch, calls };
}

export const deps = (fetch: HttpDeps['fetch']): HttpDeps & { slept: number[] } => {
  const slept: number[] = [];
  return {
    fetch,
    now: () => 1_000_000,
    sleep: async (ms) => {
      slept.push(ms);
    },
    slept,
  };
};

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export const empty = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });

export const MIB = 1024 * 1024;

/**
 * A stream of `total` bytes handed out 1 MiB at a time, only when asked for (highWaterMark 0) and
 * all pieces views onto one buffer, so a 200 MB source costs 1 MiB. `pulled` is how far it has been read.
 */
export function syntheticStream(total: number) {
  const shared = new Uint8Array(MIB);
  const progress = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (progress.pulled >= total) return controller.close();
        const n = Math.min(MIB, total - progress.pulled);
        progress.pulled += n;
        controller.enqueue(shared.subarray(0, n));
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, progress };
}
