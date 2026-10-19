import { describe, expect, it } from 'vitest';
import { DROPBOX_SCOPES, dropbox } from './dropbox';
import { CHUNK_BYTES, Permanent, QuotaExceeded, ReauthRequired, Transient } from './types';
import { MIB, deps, empty, json, mockFetch, syntheticStream, type Handler, type RecordedCall } from './test-support';

const REDIRECT = 'https://app.example/api/integrations/dropbox/callback';
const CONTENT = 'https://content.dropboxapi.com/2/files';

const make = (handler: Handler) => {
  const { fetch, calls } = mockFetch(handler);
  const d = deps(fetch);
  return { dbx: dropbox({ appKey: 'key', appSecret: 'secret' }, d), calls, slept: d.slept };
};

interface Commit {
  path: string;
  mode: string;
  autorename: boolean;
  mute: boolean;
}
/** What the tests read back from the Dropbox-API-Arg header. */
interface Arg extends Partial<Commit> {
  cursor?: { session_id: string; offset: number };
  commit?: Commit;
}
const arg = (call: RecordedCall) => JSON.parse(call.headers.get('dropbox-api-arg')!) as Arg;
const conflict = () => json({ error_summary: 'path/conflict/file/..', error: { '.tag': 'path' } }, 409);

/** A Dropbox upload-session server: tracks the session offset and the committed file. */
function dropboxUploads(total: number) {
  const state = {
    offset: 0,
    commits: [] as Commit[],
    calls: [] as { endpoint: string; offset: number | undefined; bytes: number }[],
  };
  const handler: Handler = (call) => {
    const endpoint = call.url.replace(`${CONTENT}/`, '');
    if (!call.url.startsWith(CONTENT)) return json({}, 404);
    const a = arg(call);
    state.calls.push({ endpoint, offset: a.cursor?.offset, bytes: call.bytes });
    if (endpoint === 'upload_session/start') {
      state.offset = call.bytes;
      return json({ session_id: 'S1' });
    }
    if (endpoint === 'upload_session/append_v2') {
      if (a.cursor?.offset !== state.offset)
        return json(
          { error_summary: 'incorrect_offset/..', error: { '.tag': 'incorrect_offset', correct_offset: state.offset } },
          409,
        );
      state.offset += call.bytes;
      return empty(200);
    }
    if (endpoint === 'upload_session/finish') {
      state.offset += call.bytes;
      state.commits.push(a.commit!);
      expect(state.offset).toBe(total);
      return json({ id: 'id:abc', path_display: a.commit!.path });
    }
    if (endpoint === 'upload') {
      state.commits.push(a as Commit);
      return json({ id: 'id:small', path_display: a.path });
    }
    return json({}, 404);
  };
  return { state, handler };
}

describe('Dropbox: connecting', () => {
  it('asks for offline access with the narrow scopes and echoes the state', () => {
    const { dbx } = make(() => empty(500));
    const url = new URL(dbx.authorizeUrl('STATE.abc', REDIRECT));
    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
    const p = url.searchParams;
    expect(p.get('client_id')).toBe('key');
    expect(p.get('redirect_uri')).toBe(REDIRECT);
    expect(p.get('response_type')).toBe('code');
    expect(p.get('token_access_type')).toBe('offline');
    expect(p.get('scope')!.split(' ').sort()).toEqual([...DROPBOX_SCOPES].sort());
    expect(p.get('state')).toBe('STATE.abc');
  });

  it('exchanges the code with the app credentials and reads the email (an RPC with no body)', async () => {
    const { dbx, calls } = make((call) => {
      if (call.url === 'https://api.dropboxapi.com/oauth2/token')
        return json({ access_token: 'at', refresh_token: 'rt', scope: DROPBOX_SCOPES.join(' '), expires_in: 14400 });
      if (call.url.endsWith('/users/get_current_account')) return json({ email: 'host@example.com' });
      return empty(500);
    });
    await expect(dbx.exchangeCode('the-code', REDIRECT)).resolves.toEqual({
      refreshToken: 'rt',
      accountEmail: 'host@example.com',
    });
    expect(calls[0]!.headers.get('authorization')).toBe(`Basic ${Buffer.from('key:secret').toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.text))).toMatchObject({
      code: 'the-code',
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT,
    });
    // Dropbox rejects a no-argument call that carries a content type or body.
    expect(calls[1]!.headers.get('content-type')).toBeNull();
    expect(calls[1]!.bytes).toBe(0);
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer at');
  });

  it('refuses a grant that lacks a refresh token or a scope', async () => {
    const noRefresh = make(() => json({ access_token: 'at', scope: DROPBOX_SCOPES.join(' ') }));
    await expect(noRefresh.dbx.exchangeCode('c', REDIRECT)).rejects.toMatchObject({ code: 'no_refresh_token' });
    const noScope = make(() => json({ access_token: 'at', refresh_token: 'rt', scope: 'account_info.read' }));
    await expect(noScope.dbx.exchangeCode('c', REDIRECT)).rejects.toMatchObject({ code: 'scope_missing' });
  });
});

describe('Dropbox: access tokens', () => {
  it('refreshes with the refresh token', async () => {
    const { dbx, calls } = make(() => json({ access_token: 'fresh', expires_in: 14400 }));
    const t = await dbx.accessToken('rt');
    expect(t.token).toBe('fresh');
    expect(t.expiresAt.getTime()).toBe(1_000_000 + 14_400_000);
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.text))).toMatchObject({
      refresh_token: 'rt',
      grant_type: 'refresh_token',
    });
  });

  it('maps invalid_grant to ReauthRequired and outages to Transient', async () => {
    const revoked = make(() => json({ error: 'invalid_grant', error_description: 'refresh token is revoked' }, 400));
    await expect(revoked.dbx.accessToken('rt')).rejects.toBeInstanceOf(ReauthRequired);
    const down = make(() => json({}, 503));
    await expect(down.dbx.accessToken('rt')).rejects.toBeInstanceOf(Transient);
  });
});

describe('Dropbox: folders and lookups', () => {
  it('creates a folder under the parent path', async () => {
    const { dbx, calls } = make(() =>
      json({ metadata: { '.tag': 'folder', name: 'Gala 2026-10-19', path_display: '/Immersia 360/Gala 2026-10-19' } }),
    );
    await expect(dbx.ensureFolder('tok', 'Gala 2026-10-19', '/Immersia 360')).resolves.toEqual({
      id: '/Immersia 360/Gala 2026-10-19',
      name: 'Gala 2026-10-19',
    });
    expect(JSON.parse(calls[0]!.text!)).toEqual({ path: '/Immersia 360/Gala 2026-10-19', autorename: false });
  });

  it('reuses a folder that already exists, and refuses when a file is in the way', async () => {
    const existing = make((call) =>
      call.url.endsWith('create_folder_v2')
        ? json({ error_summary: 'path/conflict/folder/..' }, 409)
        : json({ '.tag': 'folder', name: 'Immersia 360', path_display: '/Immersia 360' }),
    );
    await expect(existing.dbx.ensureFolder('tok', 'Immersia 360')).resolves.toEqual({
      id: '/Immersia 360',
      name: 'Immersia 360',
    });
    const blocked = make((call) =>
      call.url.endsWith('create_folder_v2')
        ? json({ error_summary: 'path/conflict/file/..' }, 409)
        : json({ '.tag': 'file', name: 'Immersia 360', path_display: '/Immersia 360' }),
    );
    await expect(blocked.dbx.ensureFolder('tok', 'Immersia 360')).rejects.toBeInstanceOf(Permanent);
  });

  it('strips characters Dropbox does not allow from folder names', async () => {
    const { dbx, calls } = make(() => json({ metadata: { name: 'x', path_display: '/x' } }));
    await dbx.ensureFolder('tok', 'Boda: Ana/Luis?');
    expect(JSON.parse(calls[0]!.text!).path).toBe('/Boda- Ana-Luis-');
  });

  it('findExisting returns the file, or null on path/not_found', async () => {
    const hit = make(() => json({ '.tag': 'file', id: 'id:1', path_display: '/Immersia 360/Gala/a.mp4' }));
    await expect(hit.dbx.findExisting('tok', '/Immersia 360/Gala', 'a.mp4')).resolves.toEqual({
      id: 'id:1',
      url: 'https://www.dropbox.com/home/Immersia%20360/Gala?preview=a.mp4',
    });
    const miss = make(() => json({ error_summary: 'path/not_found/..' }, 409));
    await expect(miss.dbx.findExisting('tok', '/Immersia 360/Gala', 'a.mp4')).resolves.toBeNull();
    expect(JSON.parse(miss.calls[0]!.text!)).toEqual({ path: '/Immersia 360/Gala/a.mp4' });
  });
});

describe('Dropbox: uploads', () => {
  it('sends a small file in one request that never overwrites or renames', async () => {
    const { handler, state } = dropboxUploads(5);
    const { dbx, calls } = make(handler);
    const file = await dbx.upload(
      'tok',
      '/Immersia 360/Boda de José 2026-10-19',
      '0001_a.jpg',
      'image/jpeg',
      5,
      (async function* () {
        yield new Uint8Array([1, 2, 3, 4, 5]);
      })(),
    );
    expect(file.id).toBe('id:small');
    expect(calls).toHaveLength(1);
    // The path has an accent: the header must stay ASCII, escaped as JSON.
    const header = calls[0]!.headers.get('dropbox-api-arg')!;
    expect(header).toMatch(/^[\x20-\x7e]*$/);
    expect(header).toContain('Jos\\u00e9');
    expect(state.commits[0]).toEqual({
      path: '/Immersia 360/Boda de José 2026-10-19/0001_a.jpg',
      mode: 'add',
      autorename: false,
      mute: true,
    });
    expect(calls[0]!.headers.get('content-type')).toBe('application/octet-stream');
    expect(calls[0]!.bytes).toBe(5);
  });

  it('streams a 200 MB file through an upload session in 8 MiB parts', async () => {
    const total = 200 * MIB + 12_345;
    const { handler, state } = dropboxUploads(total);
    const { stream, progress } = syntheticStream(total);
    let maxHeld = 0;
    const { dbx } = make((call) => {
      if (call.url.includes('upload_session')) maxHeld = Math.max(maxHeld, progress.pulled - state.offset);
      return handler(call);
    });
    const file = await dbx.upload('tok', '/f', 'big.mp4', 'video/mp4', total, stream);
    expect(file.id).toBe('id:abc');
    expect(state.calls.map((c) => c.endpoint)).toEqual([
      'upload_session/start',
      ...Array<string>(24).fill('upload_session/append_v2'),
      'upload_session/finish',
    ]);
    expect(state.calls.slice(0, 25).every((c) => c.bytes === CHUNK_BYTES)).toBe(true);
    expect(state.calls[25]!.bytes).toBe(12_345);
    // Each append names the offset it continues from.
    state.calls.slice(1, 25).forEach((c, i) => expect(c.offset).toBe((i + 1) * CHUNK_BYTES));
    expect(state.calls[25]!.offset).toBe(25 * CHUNK_BYTES);
    expect(state.commits[0]).toMatchObject({ path: '/f/big.mp4', mode: 'add', autorename: false });
    expect(maxHeld).toBeLessThanOrEqual(CHUNK_BYTES);
    expect(progress.pulled).toBe(total);
  });

  it('resends a part after a dropped connection without duplicating it', async () => {
    const total = 3 * CHUNK_BYTES;
    const { handler, state } = dropboxUploads(total);
    let dropped = false;
    const { dbx, slept } = make((call) => {
      if (!dropped && call.url.endsWith('append_v2')) {
        dropped = true;
        throw new TypeError('fetch failed');
      }
      return handler(call);
    });
    await dbx.upload('tok', '/f', 'a.mp4', 'video/mp4', total, syntheticStream(total).stream);
    expect(state.calls.map((c) => c.endpoint)).toEqual([
      'upload_session/start',
      'upload_session/append_v2', // retried after the dropped one
      'upload_session/finish',
    ]);
    expect(slept).toHaveLength(1);
  });

  it('treats incorrect_offset on a retried part as "that part already landed"', async () => {
    const total = 3 * CHUNK_BYTES;
    const { handler, state } = dropboxUploads(total);
    let lostResponse = false;
    const { dbx } = make(async (call) => {
      const res = await handler(call);
      if (!lostResponse && call.url.endsWith('append_v2')) {
        lostResponse = true; // Dropbox stored the part but the response never arrived
        throw new TypeError('fetch failed');
      }
      return res;
    });
    await dbx.upload('tok', '/f', 'a.mp4', 'video/mp4', total, syntheticStream(total).stream);
    expect(state.offset).toBe(total);
    expect(state.commits).toHaveLength(1);
  });

  it('on a name clash, returns the file already there instead of failing or duplicating', async () => {
    const { dbx } = make((call) =>
      call.url.endsWith('/files/upload')
        ? conflict()
        : json({ '.tag': 'file', id: 'id:there', path_display: '/f/a.jpg' }),
    );
    await expect(dbx.upload('tok', '/f', 'a.jpg', 'image/jpeg', 3, syntheticStream(3).stream)).resolves.toMatchObject({
      id: 'id:there',
    });
  });
});

describe('Dropbox: error mapping', () => {
  const failing = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    make(() => json(body, status, headers));
  const upload = (p: ReturnType<typeof make>) =>
    p.dbx.upload('tok', '/f', 'a.mp4', 'video/mp4', 3, syntheticStream(3).stream);

  it('insufficient_space is QuotaExceeded', async () => {
    const p = failing(409, {
      error_summary: 'path/insufficient_space/..',
      error: { '.tag': 'path', path: { '.tag': 'insufficient_space' } },
    });
    await expect(upload(p)).rejects.toBeInstanceOf(QuotaExceeded);
  });

  it('a 401 is ReauthRequired', async () => {
    await expect(upload(failing(401, { error_summary: 'invalid_access_token/..' }))).rejects.toBeInstanceOf(
      ReauthRequired,
    );
  });

  it('429 is Transient with the delay Dropbox asked for (header or body)', async () => {
    await expect(upload(failing(429, {}, { 'retry-after': '9' }))).rejects.toMatchObject({ retryAfterMs: 9000 });
    await expect(
      upload(
        failing(429, { error_summary: 'too_many_requests/..', error: { '.tag': 'too_many_requests', retry_after: 4 } }),
      ),
    ).rejects.toMatchObject({ name: 'Transient', retryAfterMs: 4000 });
    await expect(upload(failing(409, { error_summary: 'too_many_write_operations/..' }))).rejects.toBeInstanceOf(
      Transient,
    );
  });

  it('5xx is Transient; a missing folder is Permanent with a code', async () => {
    await expect(upload(failing(500, {}))).rejects.toBeInstanceOf(Transient);
    await expect(upload(failing(409, { error_summary: 'path/not_found/..' }))).rejects.toMatchObject({
      code: 'folder_missing',
    });
  });
});

describe('Dropbox: disconnecting', () => {
  it('revokes the token through a fresh access token', async () => {
    const { dbx, calls } = make((call) =>
      call.url.includes('oauth2/token') ? json({ access_token: 'at', expires_in: 100 }) : json(null),
    );
    await dbx.revoke('rt');
    expect(calls[1]!.url).toBe('https://api.dropboxapi.com/2/auth/token/revoke');
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer at');
  });

  it('is a no-op when the grant is already gone', async () => {
    const { dbx } = make(() => json({ error: 'invalid_grant' }, 400));
    await expect(dbx.revoke('rt')).resolves.toBeUndefined();
  });
});
