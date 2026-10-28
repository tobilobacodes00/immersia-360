/**
 * The Worker in front of the rooms: the only thing reachable from the internet. It checks who is
 * calling (a signed publish from the web app, or a screen's token), then hands the request to the
 * event's room. A room never sees a request this file hasn't vetted, so it does no auth of its own.
 *
 * Kept free of `cloudflare:workers` (that import lives in room.ts) so its request handling can be
 * tested in plain Node with a fake namespace.
 */
import { livePublishSchema, verifyLiveToken, verifyPublish } from '@immersia/shared/live';
import { parseSince } from './core';

export interface Env {
  /** One `EventRoom` per event, named by the event id. */
  ROOMS: DurableObjectNamespace;
  /** Shared with the web app (`wrangler secret put REALTIME_SIGNING_SECRET`). */
  REALTIME_SIGNING_SECRET: string;
  /** Comma-separated page origins allowed to open a socket; empty allows any. */
  ALLOWED_ORIGINS: string;
}

/** Rooms are addressed by name through the binding; this host only has to be a valid URL. */
const ROOM_URL = 'https://room.internal';
const EVENT_ROUTE = /^\/events\/([^/]+)\/(publish|socket)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** A publish is one item or a few ids: a sanity cap, well above any real message. */
const MAX_PUBLISH_BYTES = 64 * 1024;
/** The sub travels in socket tags and an attachment, both of which are size-limited. */
const MAX_SUB_LENGTH = 256;

function reply(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The request body as text, or null once it grows past `limit` bytes (without buffering the rest). */
async function readText(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (declared > limit) return null;
  if (!request.body) return '';
  const reader: ReadableStreamDefaultReader<Uint8Array> = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Browsers always send Origin on a socket handshake, so with a list configured a missing one fails. */
function originAllowed(origin: string | null, allowList: string | undefined): boolean {
  const allowed = (allowList ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return origin !== null && allowed.includes(origin.toLowerCase());
}

function roomFor(env: Env, eventId: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(eventId));
}

/** POST /events/:eventId/publish: the web app announces a change, signed over `<timestamp>.<body>`. */
async function publish(request: Request, env: Env, eventId: string): Promise<Response> {
  const timestamp = request.headers.get('x-live-timestamp');
  const signature = request.headers.get('x-live-signature');
  if (!timestamp || !signature) return reply({ error: 'unauthorized' }, 401);

  const body = await readText(request, MAX_PUBLISH_BYTES);
  if (body === null) return reply({ error: 'payload_too_large' }, 413);
  if (!(await verifyPublish(body, timestamp, signature, env.REALTIME_SIGNING_SECRET))) {
    return reply({ error: 'unauthorized' }, 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return reply({ error: 'invalid_body' }, 400);
  }
  const parsed = livePublishSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`);
    return reply({ error: 'invalid_body', issues }, 400);
  }

  try {
    // The validated message is forwarded, not the raw body, so unknown keys never reach the log.
    const response = await roomFor(env, eventId).fetch(
      new Request(`${ROOM_URL}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      }),
    );
    if (response.ok) return response;
    console.error('room refused a publish', response.status);
  } catch (error) {
    console.error('room unreachable for a publish', describe(error));
  }
  return reply({ error: 'hub_unavailable' }, 502);
}

/** GET /events/:eventId/socket?token=&since=: a screen opens its socket (a WebSocket upgrade). */
async function connect(request: Request, env: Env, eventId: string, url: URL): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return reply({ error: 'upgrade_required' }, 426, { upgrade: 'websocket' });
  }
  if (!originAllowed(request.headers.get('origin'), env.ALLOWED_ORIGINS)) return reply({ error: 'forbidden' }, 403);

  const token = url.searchParams.get('token');
  const claims = token ? await verifyLiveToken(token, env.REALTIME_SIGNING_SECRET) : null;
  if (!claims) return reply({ error: 'unauthorized' }, 401);
  // A token is for one event: it must not open another event's room.
  if (claims.eventId.toLowerCase() !== eventId || claims.sub.length > MAX_SUB_LENGTH) {
    return reply({ error: 'forbidden' }, 403);
  }
  const since = parseSince(url.searchParams.get('since'));
  if (since === undefined) return reply({ error: 'invalid_since' }, 400);

  // The room trusts these headers, so they're set here from the verified token and any copy the
  // client sent is overwritten or dropped.
  const headers = new Headers(request.headers);
  headers.set('x-live-role', claims.role);
  headers.set('x-live-sub', encodeURIComponent(claims.sub));
  headers.delete('x-live-since');
  if (since !== null) headers.set('x-live-since', String(since));

  try {
    return await roomFor(env, eventId).fetch(new Request(`${ROOM_URL}/socket`, { method: 'GET', headers }));
  } catch (error) {
    console.error('room unreachable for a socket', describe(error));
    return reply({ error: 'hub_unavailable' }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
    }

    const route = EVENT_ROUTE.exec(url.pathname);
    if (!route) return reply({ error: 'not_found' }, 404);
    const rawEventId = route[1];
    if (!rawEventId || !UUID.test(rawEventId)) return reply({ error: 'invalid_event' }, 400);
    // The same event in another case would otherwise get its own room.
    const eventId = rawEventId.toLowerCase();

    // Fail closed: without the secret nothing could be verified, so say so instead of answering 401.
    if (!env.REALTIME_SIGNING_SECRET) {
      console.error('REALTIME_SIGNING_SECRET is not set');
      return reply({ error: 'not_configured' }, 500);
    }

    if (route[2] === 'publish') {
      return request.method === 'POST'
        ? publish(request, env, eventId)
        : reply({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
    }
    return request.method === 'GET'
      ? connect(request, env, eventId, url)
      : reply({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
  },
} satisfies ExportedHandler<Env>;
