import { afterEach, describe, expect, it, vi } from 'vitest';
import { signLiveToken, signPublish, type LivePublish, type LiveRole } from '@immersia/shared/live';
import worker, { type Env } from '../src/worker';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const EVENT = '5b0e8a4c-3f2d-4a7e-9c1b-6d8f2a4e7b10';
const OTHER_EVENT = '9a1c3e5f-7b2d-4c6e-8f0a-1b3d5f7a9c2e';
const HUB = 'https://hub.test';
const FORWARDED = 'forwarded to the room';

const now = () => Math.floor(Date.now() / 1000);

const ITEM_ID = '0d3b6f1e-8a24-4c57-b9e1-2f4a6c8e0b13';

const itemPublish: LivePublish = {
  type: 'item',
  item: {
    id: ITEM_ID,
    booth: 'video360',
    shortCode: 'K7M2PQ',
    link: 'https://immersia.test/c/K7M2PQ',
    media: { type: 'video', url: '/m/K7M2PQ.mp4', poster: '/m/K7M2PQ.jpg', width: 1080, height: 1080 },
    at: '2026-10-01T18:30:00.000Z',
  },
};

/** A fake namespace that records which rooms were addressed and what each was sent. */
function makeEnv(
  overrides: Partial<Env> = {},
  respond: (request: Request) => Response | Promise<Response> = () => Response.json({ seq: 7 }),
) {
  const rooms: string[] = [];
  const sent: Request[] = [];
  const ROOMS = {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      fetch: async (request: Request) => {
        rooms.push(id.name);
        sent.push(request);
        return respond(request);
      },
    }),
  };
  const env = { ROOMS, REALTIME_SIGNING_SECRET: SECRET, ALLOWED_ORIGINS: '', ...overrides } as unknown as Env;
  return { env, rooms, sent };
}

async function publishRequest(
  message: unknown,
  {
    eventId = EVENT,
    secret = SECRET,
    at = now(),
    body,
  }: { eventId?: string; secret?: string; at?: number; body?: string } = {},
) {
  const signed = body ?? JSON.stringify(message);
  const { timestamp, signature } = await signPublish(signed, secret, at);
  return new Request(`${HUB}/events/${eventId}/publish`, {
    method: 'POST',
    headers: { 'x-live-timestamp': timestamp, 'x-live-signature': signature, 'content-type': 'application/json' },
    body: signed,
  });
}

interface TokenOptions {
  eventId?: string;
  role?: LiveRole;
  sub?: string;
  exp?: number;
  secret?: string;
}

async function tokenFor({
  eventId = EVENT,
  role = 'display',
  sub = 'display-1',
  exp = now() + 3600,
  secret = SECRET,
}: TokenOptions = {}) {
  return signLiveToken({ eventId, role, sub, exp }, secret);
}

function socketRequest(
  eventId: string,
  { token, since, headers = {} }: { token?: string | null; since?: string; headers?: Record<string, string> } = {},
) {
  const url = new URL(`${HUB}/events/${eventId}/socket`);
  if (token) url.searchParams.set('token', token);
  if (since !== undefined) url.searchParams.set('since', since);
  return new Request(url, { headers: { upgrade: 'websocket', ...headers } });
}

async function errorOf(response: Response) {
  return ((await response.json()) as { error: string }).error;
}

afterEach(() => vi.restoreAllMocks());

describe('health and routing', () => {
  it('answers /health with ok, without needing the secret', async () => {
    const { env } = makeEnv({ REALTIME_SIGNING_SECRET: '' });
    const response = await worker.fetch(new Request(`${HUB}/health`), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('404s anything else', async () => {
    const { env } = makeEnv();
    expect((await worker.fetch(new Request(`${HUB}/`), env)).status).toBe(404);
    expect((await worker.fetch(new Request(`${HUB}/events/${EVENT}`), env)).status).toBe(404);
    expect((await worker.fetch(new Request(`${HUB}/events/${EVENT}/other`), env)).status).toBe(404);
  });

  it('400s an event id that is not a UUID, before touching a room', async () => {
    const { env, rooms } = makeEnv();
    const response = await worker.fetch(await publishRequest(itemPublish, { eventId: 'not-a-uuid' }), env);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe('invalid_event');
    expect(rooms).toEqual([]);
  });

  it('fails with 500 rather than 401 when the secret was never set', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env, rooms } = makeEnv({ REALTIME_SIGNING_SECRET: '' });
    const response = await worker.fetch(await publishRequest(itemPublish), env);
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toBe('not_configured');
    expect(rooms).toEqual([]);
  });
});

describe('POST /events/:eventId/publish', () => {
  it('forwards a signed publish to that event’s room and returns its position', async () => {
    const { env, rooms, sent } = makeEnv();
    const response = await worker.fetch(await publishRequest(itemPublish), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ seq: 7 });
    expect(rooms).toEqual([EVENT]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe('POST');
    expect(new URL(sent[0]?.url ?? '').pathname).toBe('/publish');
    expect(await sent[0]?.json()).toEqual(itemPublish);
  });

  it('forwards the validated message, not the raw body', async () => {
    const { env, sent } = makeEnv();
    const response = await worker.fetch(await publishRequest({ type: 'queue', smuggled: 'x' }), env);
    expect(response.status).toBe(200);
    expect(await sent[0]?.json()).toEqual({ type: 'queue' });
  });

  it('gives an event id in capitals the same room as in lower case', async () => {
    const { env, rooms } = makeEnv();
    await worker.fetch(await publishRequest({ type: 'queue' }, { eventId: EVENT.toUpperCase() }), env);
    expect(rooms).toEqual([EVENT]);
  });

  it('401s a signature made with another secret', async () => {
    const { env, rooms } = makeEnv();
    const response = await worker.fetch(
      await publishRequest(itemPublish, { secret: 'some-other-secret-value-0123456789' }),
      env,
    );
    expect(response.status).toBe(401);
    expect(rooms).toEqual([]);
  });

  it('401s a body that changed after it was signed', async () => {
    const { env, rooms } = makeEnv();
    const request = await publishRequest({ type: 'queue' });
    const tampered = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ type: 'remove', id: ITEM_ID }),
    });
    expect((await worker.fetch(tampered, env)).status).toBe(401);
    expect(rooms).toEqual([]);
  });

  it('401s a timestamp outside the five-minute window, in either direction', async () => {
    const { env, rooms } = makeEnv();
    expect((await worker.fetch(await publishRequest(itemPublish, { at: now() - 301 }), env)).status).toBe(401);
    expect((await worker.fetch(await publishRequest(itemPublish, { at: now() + 301 }), env)).status).toBe(401);
    expect(rooms).toEqual([]);
    expect((await worker.fetch(await publishRequest(itemPublish, { at: now() - 240 }), env)).status).toBe(200);
  });

  it('401s a request without the signature headers', async () => {
    const { env, rooms } = makeEnv();
    const unsigned = new Request(`${HUB}/events/${EVENT}/publish`, {
      method: 'POST',
      body: JSON.stringify(itemPublish),
    });
    expect((await worker.fetch(unsigned, env)).status).toBe(401);
    expect(rooms).toEqual([]);
  });

  it('400s a correctly signed body that is not a publish', async () => {
    const { env, rooms } = makeEnv();
    const unknownType = await worker.fetch(await publishRequest({ type: 'explode' }), env);
    expect(unknownType.status).toBe(400);
    expect(await errorOf(unknownType)).toBe('invalid_body');
    const badItem = await worker.fetch(await publishRequest({ type: 'remove', id: 'not-a-uuid' }), env);
    expect(badItem.status).toBe(400);
    expect(rooms).toEqual([]);
  });

  it('400s a correctly signed body that is not JSON', async () => {
    const { env, rooms } = makeEnv();
    const response = await worker.fetch(await publishRequest(null, { body: 'definitely not json' }), env);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe('invalid_body');
    expect(rooms).toEqual([]);
  });

  it('413s a body past the size cap before checking anything else about it', async () => {
    const { env, rooms } = makeEnv();
    const response = await worker.fetch(await publishRequest(null, { body: 'x'.repeat(70_000) }), env);
    expect(response.status).toBe(413);
    expect(rooms).toEqual([]);
  });

  it('405s other methods', async () => {
    const { env } = makeEnv();
    const response = await worker.fetch(new Request(`${HUB}/events/${EVENT}/publish`), env);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('502s when the room fails, without echoing why', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env } = makeEnv({}, () => {
      throw new Error('storage exploded at /secret/path');
    });
    const response = await worker.fetch(await publishRequest(itemPublish), env);
    expect(response.status).toBe(502);
    expect(await errorOf(response)).toBe('hub_unavailable');
    expect(spy).toHaveBeenCalled();

    const refusing = makeEnv({}, () => new Response('nope', { status: 500 }));
    expect((await worker.fetch(await publishRequest(itemPublish), refusing.env)).status).toBe(502);
  });
});

describe('GET /events/:eventId/socket', () => {
  it('426s a request that is not a WebSocket upgrade', async () => {
    const { env, rooms } = makeEnv();
    const token = await tokenFor();
    const plain = new Request(`${HUB}/events/${EVENT}/socket?token=${token}`);
    const response = await worker.fetch(plain, env);
    expect(response.status).toBe(426);
    expect(response.headers.get('upgrade')).toBe('websocket');
    expect(rooms).toEqual([]);
  });

  it('401s a missing, malformed, wrongly signed or expired token', async () => {
    const { env, rooms } = makeEnv();
    const tokens = [
      null,
      'garbage',
      'a.b.c',
      await tokenFor({ secret: 'some-other-secret-value-0123456789' }),
      await tokenFor({ exp: now() - 10 }),
    ];
    for (const token of tokens) {
      const response = await worker.fetch(socketRequest(EVENT, { token }), env);
      expect(response.status).toBe(401);
    }
    expect(rooms).toEqual([]);
  });

  it('403s a token for another event, before touching a room', async () => {
    const { env, rooms } = makeEnv();
    const token = await tokenFor({ eventId: OTHER_EVENT });
    const response = await worker.fetch(socketRequest(EVENT, { token }), env);
    expect(response.status).toBe(403);
    expect(rooms).toEqual([]);
  });

  it('403s a sub too long for socket tags', async () => {
    const { env, rooms } = makeEnv();
    const token = await tokenFor({ sub: 'x'.repeat(257) });
    expect((await worker.fetch(socketRequest(EVENT, { token }), env)).status).toBe(403);
    expect(rooms).toEqual([]);
  });

  it('400s a since that is not a position', async () => {
    const { env, rooms } = makeEnv();
    const token = await tokenFor();
    for (const since of ['-3', 'abc', '1.5']) {
      expect((await worker.fetch(socketRequest(EVENT, { token, since }), env)).status).toBe(400);
    }
    expect(rooms).toEqual([]);
  });

  it('405s other methods', async () => {
    const { env } = makeEnv();
    const post = new Request(`${HUB}/events/${EVENT}/socket`, { method: 'POST', headers: { upgrade: 'websocket' } });
    const response = await worker.fetch(post, env);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('hands a verified screen to its event’s room and returns the room’s answer', async () => {
    const { env, rooms, sent } = makeEnv({}, () => new Response(FORWARDED));
    const token = await tokenFor({ role: 'operator', sub: 'user-42' });
    const response = await worker.fetch(socketRequest(EVENT, { token, since: '12' }), env);
    expect(await response.text()).toBe(FORWARDED);
    expect(rooms).toEqual([EVENT]);

    const forwarded = sent[0];
    expect(forwarded?.method).toBe('GET');
    expect(new URL(forwarded?.url ?? '').pathname).toBe('/socket');
    expect(forwarded?.headers.get('upgrade')).toBe('websocket');
    expect(forwarded?.headers.get('x-live-role')).toBe('operator');
    expect(forwarded?.headers.get('x-live-sub')).toBe('user-42');
    expect(forwarded?.headers.get('x-live-since')).toBe('12');
  });

  it('passes no since when the screen sent none, and never trusts one it put in a header', async () => {
    const { env, sent } = makeEnv({}, () => new Response(FORWARDED));
    const token = await tokenFor();
    await worker.fetch(socketRequest(EVENT, { token, headers: { 'x-live-since': '3' } }), env);
    expect(sent[0]?.headers.has('x-live-since')).toBe(false);
  });

  it('takes role and sub from the token, whatever the client put in its headers', async () => {
    const { env, sent } = makeEnv({}, () => new Response(FORWARDED));
    const token = await tokenFor({ role: 'display', sub: 'display-9' });
    const spoofed = { 'x-live-role': 'operator', 'x-live-sub': 'someone-else' };
    await worker.fetch(socketRequest(EVENT, { token, headers: spoofed }), env);
    expect(sent[0]?.headers.get('x-live-role')).toBe('display');
    expect(sent[0]?.headers.get('x-live-sub')).toBe('display-9');
  });

  it('encodes a sub that is not plain ASCII so it survives as a header', async () => {
    const { env, sent } = makeEnv({}, () => new Response(FORWARDED));
    const sub = 'booth é/1';
    const token = await tokenFor({ role: 'station', sub });
    await worker.fetch(socketRequest(EVENT, { token }), env);
    expect(decodeURIComponent(sent[0]?.headers.get('x-live-sub') ?? '')).toBe(sub);
  });

  it('does not pass the token on to the room', async () => {
    const { env, sent } = makeEnv({}, () => new Response(FORWARDED));
    const token = await tokenFor();
    await worker.fetch(socketRequest(EVENT, { token }), env);
    expect(sent[0]?.url).not.toContain(token);
    for (const [, value] of sent[0]?.headers ?? []) expect(value).not.toContain(token);
  });

  it('keeps the token out of the logs when the room fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env } = makeEnv({}, () => {
      throw new Error('room down');
    });
    const token = await tokenFor();
    const response = await worker.fetch(socketRequest(EVENT, { token }), env);
    expect(response.status).toBe(502);
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toContain(token);
  });

  describe('with ALLOWED_ORIGINS set', () => {
    const ALLOWED = 'https://app.immersia.test, https://events.immersia.test/';

    it('403s an origin that is not listed, and a request with no origin', async () => {
      const { env, rooms } = makeEnv({ ALLOWED_ORIGINS: ALLOWED });
      const token = await tokenFor();
      const stranger = socketRequest(EVENT, { token, headers: { origin: 'https://evil.test' } });
      expect((await worker.fetch(stranger, env)).status).toBe(403);
      expect((await worker.fetch(socketRequest(EVENT, { token }), env)).status).toBe(403);
      expect(rooms).toEqual([]);
    });

    it('lets listed origins in, ignoring case and a trailing slash in the list', async () => {
      const { env, rooms } = makeEnv({ ALLOWED_ORIGINS: ALLOWED }, () => new Response(FORWARDED));
      const token = await tokenFor();
      for (const origin of ['https://app.immersia.test', 'https://EVENTS.immersia.test']) {
        const response = await worker.fetch(socketRequest(EVENT, { token, headers: { origin } }), env);
        expect(await response.text()).toBe(FORWARDED);
      }
      expect(rooms).toHaveLength(2);
    });

    it('allows any origin when the list is empty or only blanks', async () => {
      for (const ALLOWED_ORIGINS of ['', ' , ']) {
        const { env, rooms } = makeEnv({ ALLOWED_ORIGINS }, () => new Response(FORWARDED));
        const token = await tokenFor();
        await worker.fetch(socketRequest(EVENT, { token, headers: { origin: 'https://anywhere.test' } }), env);
        expect(rooms).toEqual([EVENT]);
      }
    });
  });
});
