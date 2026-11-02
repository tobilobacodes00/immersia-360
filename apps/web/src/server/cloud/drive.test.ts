import { describe, expect, it } from 'vitest';
import { DRIVE_SCOPE, googleDrive } from './drive';
import { CHUNK_BYTES, Permanent, QuotaExceeded, ReauthRequired, Transient } from './types';
import { MIB, deps, empty, json, mockFetch, syntheticStream, type Handler, type RecordedCall } from './test-support';

const SESSION = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=SESSION1';
const REDIRECT = 'https://app.example/api/integrations/drive/callback';

const make = (handler: Handler) => {
  const { fetch, calls } = mockFetch(handler);
  const d = deps(fetch);
  return { drive: googleDrive({ clientId: 'cid', clientSecret: 'csecret' }, d), calls, slept: d.slept };
};

const form = (call: RecordedCall) => new URLSearchParams(call.text);

/** A minimal Drive resumable-upload server: tracks how many bytes it holds, answers like Drive does. */
function driveUploads(total: number) {
  const state = { received: 0, parts: [] as { start: number; end: number; bytes: number }[] };
  const handler: Handler = (call) => {
    if (call.method === 'POST' && call.url.includes('uploadType=resumable')) return empty(200, { location: SESSION });
    if (call.url === SESSION && call.method === 'PUT') {
      const range = call.headers.get('content-range') ?? '';
      const part = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
      if (!part) {
        // A status query (`bytes */total`).
        return state.received === 0 ? empty(308) : empty(308, { range: `bytes=0-${state.received - 1}` });
      }
      const [start, end] = [Number(part[1]), Number(part[2])];
      state.parts.push({ start, end, bytes: call.bytes });
      if (start !== state.received) return empty(308, { range: `bytes=0-${state.received - 1}` });
      state.received = end + 1;
      return state.received === total
        ? json({ id: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1/view?usp=drivesdk' })
        : empty(308, { range: `bytes=0-${end}` });
    }
    return json({ error: { code: 404 } }, 404);
  };
  return { state, handler };
}

describe('Google Drive: connecting', () => {
  it('asks for drive.file only, offline, with a consent screen, and echoes the state', () => {
    const { drive } = make(() => empty(500));
    const url = new URL(drive.authorizeUrl('STATE.abc', REDIRECT));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const p = url.searchParams;
    expect(p.get('client_id')).toBe('cid');
    expect(p.get('redirect_uri')).toBe(REDIRECT);
    expect(p.get('response_type')).toBe('code');
    expect(p.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('prompt')).toBe('consent');
    expect(p.get('state')).toBe('STATE.abc');
  });

  it('exchanges the code for a refresh token and reads the account email', async () => {
    const { drive, calls } = make((call) => {
      if (call.url === 'https://oauth2.googleapis.com/token')
        return json({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: DRIVE_SCOPE });
      if (call.url.startsWith('https://www.googleapis.com/drive/v3/about'))
        return json({ user: { emailAddress: 'host@gmail.com' } });
      return empty(500);
    });
    await expect(drive.exchangeCode('the-code', REDIRECT)).resolves.toEqual({
      refreshToken: 'rt',
      accountEmail: 'host@gmail.com',
    });
    const body = form(calls[0]!);
    expect(Object.fromEntries(body)).toMatchObject({
      code: 'the-code',
      client_id: 'cid',
      client_secret: 'csecret',
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    });
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer at');
  });

  it('still connects when the email cannot be read', async () => {
    const { drive } = make((call) =>
      call.url.includes('oauth2')
        ? json({ access_token: 'at', refresh_token: 'rt', scope: DRIVE_SCOPE })
        : json({}, 500),
    );
    await expect(drive.exchangeCode('c', REDIRECT)).resolves.toEqual({ refreshToken: 'rt', accountEmail: null });
  });

  it('refuses a grant without a refresh token, or without the Drive permission', async () => {
    const noRefresh = make(() => json({ access_token: 'at', scope: DRIVE_SCOPE }));
    await expect(noRefresh.drive.exchangeCode('c', REDIRECT)).rejects.toMatchObject({ code: 'no_refresh_token' });
    const noScope = make(() => json({ access_token: 'at', refresh_token: 'rt', scope: 'openid' }));
    await expect(noScope.drive.exchangeCode('c', REDIRECT)).rejects.toMatchObject({ code: 'scope_missing' });
  });

  it('turns a rejected code into a permanent error', async () => {
    const { drive } = make(() => json({ error: 'invalid_grant' }, 400));
    await expect(drive.exchangeCode('used', REDIRECT)).rejects.toBeInstanceOf(Permanent);
  });
});

describe('Google Drive: access tokens', () => {
  it('refreshes with the stored refresh token', async () => {
    const { drive, calls } = make(() => json({ access_token: 'fresh', expires_in: 3600 }));
    const t = await drive.accessToken('rt');
    expect(t.token).toBe('fresh');
    expect(t.expiresAt.getTime()).toBe(1_000_000 + 3600_000);
    expect(Object.fromEntries(form(calls[0]!))).toMatchObject({ refresh_token: 'rt', grant_type: 'refresh_token' });
  });

  it('maps invalid_grant (revoked or expired grant) to ReauthRequired', async () => {
    const { drive } = make(() => json({ error: 'invalid_grant', error_description: 'Token has been revoked.' }, 400));
    await expect(drive.accessToken('rt')).rejects.toBeInstanceOf(ReauthRequired);
  });

  it('treats provider outages as transient and honours Retry-After', async () => {
    const { drive } = make(() => json({ error: 'backend' }, 503));
    await expect(drive.accessToken('rt')).rejects.toBeInstanceOf(Transient);
    const limited = make(() => json({}, 429, { 'retry-after': '12' }));
    await expect(limited.drive.accessToken('rt')).rejects.toMatchObject({ retryAfterMs: 12_000 });
  });

  it('reports a network failure as transient without leaking the URL', async () => {
    const { drive } = make(() => {
      throw new TypeError('fetch failed: https://oauth2.googleapis.com/token');
    });
    const err = await drive.accessToken('rt-secret').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Transient);
    expect((err as Error).message).not.toContain('googleapis');
    expect((err as Error).message).not.toContain('rt-secret');
  });
});

describe('Google Drive: folders and lookups', () => {
  it('finds an existing folder instead of creating a second one', async () => {
    const { drive, calls } = make(() => json({ files: [{ id: 'f1', name: 'Immersia 360' }] }));
    await expect(drive.ensureFolder('tok', 'Immersia 360')).resolves.toEqual({ id: 'f1', name: 'Immersia 360' });
    expect(calls).toHaveLength(1);
    const q = new URL(calls[0]!.url).searchParams.get('q')!;
    expect(q).toContain("name='Immersia 360'");
    expect(q).toContain("'root' in parents");
    expect(q).toContain('trashed=false');
  });

  it('creates the folder under the parent when there is none', async () => {
    const { drive, calls } = make((call) =>
      call.method === 'GET' ? json({ files: [] }) : json({ id: 'new', name: 'Gala' }),
    );
    await expect(drive.ensureFolder('tok', 'Gala', 'parent-1')).resolves.toEqual({ id: 'new', name: 'Gala' });
    const create = calls[1]!;
    expect(create.method).toBe('POST');
    expect(JSON.parse(create.text!)).toEqual({
      name: 'Gala',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['parent-1'],
    });
  });

  it("escapes quotes and backslashes in names so a name can't change the query", async () => {
    const { drive, calls } = make(() => json({ files: [] }));
    await drive.findExisting('tok', 'folder', "it's a\\b.mp4");
    expect(new URL(calls[0]!.url).searchParams.get('q')).toContain("name='it\\'s a\\\\b.mp4'");
  });

  it('findExisting returns the file or null', async () => {
    const hit = make(() => json({ files: [{ id: 'x', webViewLink: 'https://drive.google.com/file/d/x/view' }] }));
    await expect(hit.drive.findExisting('tok', 'f', 'a.mp4')).resolves.toEqual({
      id: 'x',
      url: 'https://drive.google.com/file/d/x/view',
    });
    const miss = make(() => json({ files: [] }));
    await expect(miss.drive.findExisting('tok', 'f', 'a.mp4')).resolves.toBeNull();
  });
});

describe('Google Drive: resumable uploads', () => {
  it('uploads a small file as one part', async () => {
    const { handler, state } = driveUploads(5);
    const { drive, calls } = make(handler);
    const file = await drive.upload(
      'tok',
      'folder-1',
      'a.jpg',
      'image/jpeg',
      5,
      (async function* () {
        yield new Uint8Array([1, 2, 3, 4, 5]);
      })(),
    );
    expect(file).toEqual({ id: 'file-1', url: 'https://drive.google.com/file/d/file-1/view?usp=drivesdk' });
    const init = calls[0]!;
    expect(init.headers.get('x-upload-content-length')).toBe('5');
    expect(init.headers.get('x-upload-content-type')).toBe('image/jpeg');
    expect(JSON.parse(init.text!)).toMatchObject({ name: 'a.jpg', parents: ['folder-1'] });
    expect(state.parts).toEqual([{ start: 0, end: 4, bytes: 5 }]);
    expect(calls[1]!.headers.get('content-range')).toBe('bytes 0-4/5');
  });

  it('streams a 200 MB file in 8 MiB parts without holding more than one part', async () => {
    const total = 200 * MIB + 12_345; // not a multiple of the part size
    const { handler, state } = driveUploads(total);
    const { stream, progress } = syntheticStream(total);
    let maxHeld = 0;
    const { drive } = make((call) => {
      if (call.method === 'PUT') maxHeld = Math.max(maxHeld, progress.pulled - state.received);
      return handler(call);
    });
    const file = await drive.upload('tok', 'f', 'big.mp4', 'video/mp4', total, stream);
    expect(file.id).toBe('file-1');
    expect(state.received).toBe(total);
    expect(state.parts).toHaveLength(26);
    expect(state.parts.slice(0, 25).every((p) => p.bytes === CHUNK_BYTES)).toBe(true);
    expect(state.parts[25]).toEqual({ start: 25 * CHUNK_BYTES, end: total - 1, bytes: 12_345 });
    // Contiguous, in order.
    state.parts.forEach((p, i) => expect(p.start).toBe(i * CHUNK_BYTES));
    // The source was read as the parts were sent: never more than one part ahead of Drive.
    expect(maxHeld).toBeLessThanOrEqual(CHUNK_BYTES);
    expect(progress.pulled).toBe(total);
  });

  it('after a failed part, asks Drive what it kept and resends only the rest', async () => {
    const total = 2 * CHUNK_BYTES;
    const { handler, state } = driveUploads(total);
    const { stream } = syntheticStream(total);
    let failed = false;
    const kept = 3 * MIB;
    const { drive, calls, slept } = make((call) => {
      const range = call.headers.get('content-range') ?? '';
      if (!failed && range.startsWith(`bytes ${CHUNK_BYTES}-`)) {
        failed = true;
        // Drive stored 3 MiB of the second part, then the connection died.
        state.received = CHUNK_BYTES + kept;
        return empty(503);
      }
      return handler(call);
    });
    await drive.upload('tok', 'f', 'a.mp4', 'video/mp4', total, stream);
    const puts = calls.filter((c) => c.method === 'PUT').map((c) => c.headers.get('content-range'));
    expect(puts).toEqual([
      `bytes 0-${CHUNK_BYTES - 1}/${total}`,
      `bytes ${CHUNK_BYTES}-${total - 1}/${total}`, // 503
      `bytes */${total}`, // how much did you keep?
      `bytes ${CHUNK_BYTES + kept}-${total - 1}/${total}`, // only the rest
    ]);
    expect(state.received).toBe(total);
    expect(slept).toHaveLength(1);
  });

  it('gives up after repeated failures so the queue can try later', async () => {
    const total = 1000;
    const { stream } = syntheticStream(total);
    const { drive, slept } = make((call) => {
      if (call.method === 'POST') return empty(200, { location: SESSION });
      return empty(503, { 'retry-after': '3' });
    });
    await expect(drive.upload('tok', 'f', 'a.mp4', 'video/mp4', total, stream)).rejects.toBeInstanceOf(Transient);
    expect(slept.length).toBeGreaterThanOrEqual(5);
    expect(Math.min(...slept)).toBeGreaterThanOrEqual(3000);
  });

  it('restarts the whole upload when the session has expired', async () => {
    const { stream } = syntheticStream(100);
    const { drive } = make((call) =>
      call.method === 'POST' ? empty(200, { location: SESSION }) : json({ error: {} }, 404),
    );
    await expect(drive.upload('tok', 'f', 'a.mp4', 'video/mp4', 100, stream)).rejects.toBeInstanceOf(Transient);
  });

  it('fails when the source is shorter or longer than announced', async () => {
    const short = driveUploads(100);
    await expect(
      make(short.handler).drive.upload('tok', 'f', 'a', 'video/mp4', 100, syntheticStream(60).stream),
    ).rejects.toBeInstanceOf(Transient);
    const long = driveUploads(100);
    await expect(
      make(long.handler).drive.upload('tok', 'f', 'a', 'video/mp4', 100, syntheticStream(160).stream),
    ).rejects.toBeInstanceOf(Transient);
  });
});

describe('Google Drive: error mapping', () => {
  const failing = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    make(() => json(body, status, headers));
  const upload = (p: ReturnType<typeof make>) =>
    p.drive.upload('tok', 'f', 'a.mp4', 'video/mp4', 3, syntheticStream(3).stream);

  it('storageQuotaExceeded is QuotaExceeded', async () => {
    const p = failing(403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } });
    await expect(upload(p)).rejects.toBeInstanceOf(QuotaExceeded);
  });

  it('a 401 is ReauthRequired (the grant was revoked)', async () => {
    await expect(upload(failing(401, { error: { code: 401, status: 'UNAUTHENTICATED' } }))).rejects.toBeInstanceOf(
      ReauthRequired,
    );
  });

  it('429 is Transient with the Retry-After delay; rate-limit 403s too', async () => {
    await expect(upload(failing(429, {}, { 'retry-after': '7' }))).rejects.toMatchObject({
      name: 'Transient',
      retryAfterMs: 7000,
    });
    await expect(
      upload(failing(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } })),
    ).rejects.toBeInstanceOf(Transient);
  });

  it('5xx is Transient', async () => {
    await expect(upload(failing(502, {}))).rejects.toBeInstanceOf(Transient);
  });

  it('a missing or foreign folder is Permanent with a code the UI can explain', async () => {
    await expect(upload(failing(404, { error: { code: 404 } }))).rejects.toMatchObject({ code: 'folder_missing' });
    await expect(
      upload(failing(403, { error: { errors: [{ reason: 'appNotAuthorizedToFile' }] } })),
    ).rejects.toMatchObject({ code: 'folder_inaccessible' });
  });
});

describe('Google Drive: disconnecting', () => {
  it('revokes the refresh token at Google and shrugs off an already-revoked token', async () => {
    const { drive, calls } = make(() => json({ error: 'invalid_token' }, 400));
    await expect(drive.revoke('rt')).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/revoke');
    expect(form(calls[0]!).get('token')).toBe('rt');
  });
});
