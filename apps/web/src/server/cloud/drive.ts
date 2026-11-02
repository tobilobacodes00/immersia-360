import {
  CHUNK_BYTES,
  Permanent,
  QuotaExceeded,
  ReauthRequired,
  Transient,
  type AccessToken,
  type CloudError,
  type CloudFile,
  type CloudFolder,
  type CloudProvider,
  type UploadBody,
} from './types';
import {
  PART_RETRIES,
  asRecord,
  chunked,
  formBody,
  formHeaders,
  partBackoffMs,
  readJson,
  retryAfterMs,
  send,
  str,
  withDeps,
  withQuery,
  type HttpDeps,
} from './util';

/**
 * Google Drive. The `drive.file` scope only: the app sees and touches nothing but files and
 * folders it created itself, so a connected account is never browsable by us.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
}

/** Drive query strings quote with ' and escape \ and '. */
const q = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The whole upload has to start over (a new session), not just this part. */
class RestartUpload extends Transient {}

const fileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'sharingRateLimitExceeded',
  'quotaExceeded',
  'dailyLimitExceeded',
  'backendError',
]);

/** Map a Drive API failure to a typed error. `body` is the parsed JSON error envelope, if any. */
function driveError(res: Response, body: unknown, now: number): CloudError {
  const error = asRecord(asRecord(body).error);
  const reason = str(asRecord((Array.isArray(error.errors) ? error.errors : [])[0]).reason) ?? str(error.status);
  const detail = reason ? ` (${reason})` : '';
  const status = res.status;
  if (status === 401) return new ReauthRequired(`Google Drive rejected the access token${detail}`);
  if (status === 403) {
    if (reason === 'storageQuotaExceeded') return new QuotaExceeded('The Google Drive is full');
    if (reason && RATE_LIMIT_REASONS.has(reason))
      return new Transient(`Google Drive is rate limiting${detail}`, retryAfterMs(res.headers, now));
    if (reason === 'insufficientPermissions' || reason === 'insufficientScopes' || reason === 'authError')
      return new ReauthRequired(`Google Drive access was not granted${detail}`);
    if (reason === 'appNotAuthorizedToFile' || reason === 'insufficientFilePermissions')
      return new Permanent('folder_inaccessible', `Immersia cannot write to that folder${detail}`);
    return new Permanent('forbidden', `Google Drive refused the request${detail}`);
  }
  if (status === 404) return new Permanent('folder_missing', `Google Drive could not find the folder${detail}`);
  if (status === 408 || status === 429 || status >= 500)
    return new Transient(`Google Drive answered ${status}${detail}`, retryAfterMs(res.headers, now));
  return new Permanent(`http_${status}`, `Google Drive answered ${status}${detail}`);
}

export function googleDrive(config: DriveConfig, overrides?: Partial<HttpDeps>): CloudProvider {
  const deps = withDeps(overrides);

  async function call(
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
    token: string,
  ): Promise<unknown> {
    const res = await send(deps, url, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
    const body = await readJson(res);
    if (!res.ok) throw driveError(res, body, deps.now());
    return body;
  }

  /** Token endpoint: `invalid_grant` is the grant being revoked or expired, whatever the status. */
  async function tokenRequest(params: Record<string, string>, onBadGrant: () => CloudError, failCode: string) {
    const res = await send(deps, TOKEN_URL, {
      method: 'POST',
      headers: formHeaders,
      body: formBody({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
    });
    const body = asRecord(await readJson(res));
    if (res.ok) return body;
    const code = str(body.error);
    if (code === 'invalid_grant') throw onBadGrant();
    if (code === 'invalid_client' || code === 'unauthorized_client')
      throw new Permanent('provider_config', 'The Google OAuth client is not set up correctly');
    if (res.status === 429 || res.status >= 500)
      throw new Transient(`Google sign-in answered ${res.status}`, retryAfterMs(res.headers, deps.now()));
    throw new Permanent(failCode, `Google sign-in answered ${res.status}${code ? ` (${code})` : ''}`);
  }

  /** Start a resumable session; the returned URL accepts the file's bytes. */
  async function startSession(
    token: string,
    folderId: string,
    filename: string,
    mime: string,
    size: number,
  ): Promise<string> {
    const res = await send(deps, withQuery(UPLOAD, { uploadType: 'resumable', fields: 'id,webViewLink' }), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': mime,
        'x-upload-content-length': String(size),
      },
      body: JSON.stringify({ name: filename, parents: [folderId], mimeType: mime }),
    });
    if (!res.ok) throw driveError(res, await readJson(res), deps.now());
    const location = res.headers.get('location');
    if (!location) throw new Transient('Google Drive did not open an upload session');
    return location;
  }

  /** What Drive holds after a request to the session: a byte count so far, or the finished file. */
  type Progress = { kind: 'partial'; received: number } | { kind: 'done'; file: CloudFile };

  const toFile = (body: unknown): CloudFile => {
    const rec = asRecord(body);
    const id = str(rec.id);
    if (!id) throw new Transient('Google Drive did not return the new file');
    return { id, url: str(rec.webViewLink) ?? fileUrl(id) };
  };

  async function readProgress(res: Response): Promise<Progress> {
    if (res.status === 308) {
      // `Range: bytes=0-N` means N+1 bytes are stored; no header at all means nothing yet.
      const range = /^bytes=0-(\d+)$/.exec(res.headers.get('range') ?? '');
      return { kind: 'partial', received: range ? Number(range[1]) + 1 : 0 };
    }
    if (res.status === 200 || res.status === 201) return { kind: 'done', file: toFile(await readJson(res)) };
    // The session is gone (Drive drops it after a week of silence): start over from the queue.
    if (res.status === 404 || res.status === 410) throw new RestartUpload('The upload session expired');
    throw driveError(res, await readJson(res), deps.now());
  }

  /** Ask Drive how much of the file it holds. */
  async function queryProgress(session: string, total: number): Promise<Progress> {
    return readProgress(await send(deps, session, { method: 'PUT', headers: { 'content-range': `bytes */${total}` } }));
  }

  /**
   * Send one part of the file. If the request fails in flight, ask Drive what it kept and resend
   * only the rest, so a flaky connection never re-uploads (or double-counts) earlier bytes.
   */
  async function putPart(session: string, part: Uint8Array<ArrayBuffer>, start: number, total: number) {
    const end = start + part.length; // exclusive
    let from = start; // the first byte of this part Drive has not confirmed
    /** The finished result, or undefined when part of this part still has to be (re)sent. */
    const settle = (p: Progress): Progress | undefined => {
      if (p.kind === 'done' || p.received >= end) return p;
      if (p.received < start) throw new RestartUpload('Google Drive lost earlier parts of the upload');
      from = p.received;
      return undefined;
    };
    for (let attempt = 0; ; attempt++) {
      let failure: Transient | undefined;
      try {
        const res = await send(
          deps,
          session,
          {
            method: 'PUT',
            headers: { 'content-range': `bytes ${from}-${end - 1}/${total}` },
            body: part.subarray(from - start),
          },
          120_000,
        );
        if (res.status >= 500 || res.status === 429 || res.status === 408)
          failure = new Transient(`Google Drive answered ${res.status}`, retryAfterMs(res.headers, deps.now()));
        else {
          const settled = settle(await readProgress(res));
          if (settled) return settled;
        }
      } catch (err) {
        if (!(err instanceof Transient) || err instanceof RestartUpload) throw err;
        failure = err;
      }
      if (attempt >= PART_RETRIES) throw failure ?? new Transient('Google Drive is not accepting the upload');
      if (!failure) continue; // Drive kept only part of it: send the rest right away
      await deps.sleep(Math.max(partBackoffMs(attempt), failure.retryAfterMs ?? 0));
      try {
        const settled = settle(await queryProgress(session, total));
        if (settled) return settled;
      } catch (err) {
        // If the status query failed too, the next loop resends from the last known offset.
        if (!(err instanceof Transient) || err instanceof RestartUpload) throw err;
      }
    }
  }

  return {
    id: 'drive',

    authorizeUrl(state, redirectUri) {
      return withQuery(AUTH_URL, {
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: DRIVE_SCOPE,
        // Offline access + a forced consent screen is what makes Google return a refresh token every time.
        access_type: 'offline',
        prompt: 'consent',
        state,
      });
    },

    async exchangeCode(code, redirectUri) {
      const body = await tokenRequest(
        { code, redirect_uri: redirectUri, grant_type: 'authorization_code' },
        () => new Permanent('exchange_failed', 'Google rejected the authorization code'),
        'exchange_failed',
      );
      const refreshToken = str(body.refresh_token);
      if (!refreshToken) throw new Permanent('no_refresh_token', 'Google did not return a refresh token');
      // The user can untick the Drive permission on the consent screen.
      if (!(str(body.scope) ?? '').split(' ').includes(DRIVE_SCOPE))
        throw new Permanent('scope_missing', 'Google Drive access was not granted');
      let accountEmail: string | null = null;
      const access = str(body.access_token);
      if (access) {
        try {
          const about = asRecord(
            await call(withQuery(`${API}/about`, { fields: 'user(emailAddress)' }), { method: 'GET' }, access),
          );
          accountEmail = str(asRecord(about.user).emailAddress) ?? null;
        } catch {
          // The email is only a label; a connection without one is still a connection.
        }
      }
      return { refreshToken, accountEmail };
    },

    async accessToken(refreshToken): Promise<AccessToken> {
      const body = await tokenRequest(
        { refresh_token: refreshToken, grant_type: 'refresh_token' },
        () => new ReauthRequired('Google no longer accepts this connection'),
        'token_failed',
      );
      const token = str(body.access_token);
      if (!token) throw new Transient('Google did not return an access token');
      const seconds = typeof body.expires_in === 'number' ? body.expires_in : 3600;
      return { token, expiresAt: new Date(deps.now() + seconds * 1000) };
    },

    async ensureFolder(token, name, parentId): Promise<CloudFolder> {
      const parent = parentId ?? 'root';
      const list = asRecord(
        await call(
          withQuery(`${API}/files`, {
            q: `mimeType=${q(FOLDER_MIME)} and name=${q(name)} and ${q(parent)} in parents and trashed=false`,
            fields: 'files(id,name)',
            orderBy: 'createdTime',
            pageSize: '1',
            spaces: 'drive',
          }),
          { method: 'GET' },
          token,
        ),
      );
      const found = asRecord((Array.isArray(list.files) ? list.files : [])[0]);
      const foundId = str(found.id);
      if (foundId) return { id: foundId, name: str(found.name) ?? name };
      const created = asRecord(
        await call(
          withQuery(`${API}/files`, { fields: 'id,name' }),
          {
            method: 'POST',
            headers: { 'content-type': 'application/json; charset=UTF-8' },
            body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
          },
          token,
        ),
      );
      const id = str(created.id);
      if (!id) throw new Transient('Google Drive did not return the new folder');
      return { id, name: str(created.name) ?? name };
    },

    async upload(token, folderId, filename, mime, size, body: UploadBody): Promise<CloudFile> {
      const session = await startSession(token, folderId, filename, mime, size);
      if (size === 0) {
        const result = await readProgress(await send(deps, session, { method: 'PUT' }));
        if (result.kind === 'done') return result.file;
        throw new Transient('Google Drive did not finish an empty upload');
      }
      let offset = 0;
      let file: CloudFile | undefined;
      for await (const part of chunked(body, CHUNK_BYTES)) {
        if (offset + part.length > size) throw new Transient('The source is longer than expected');
        const result = await putPart(session, part, offset, size);
        offset += part.length;
        if (result.kind === 'done') file = result.file;
      }
      if (offset !== size) throw new Transient('The source ended before the expected size');
      if (!file) throw new Transient('Google Drive did not confirm the upload');
      return file;
    },

    async findExisting(token, folderId, filename): Promise<CloudFile | null> {
      const list = asRecord(
        await call(
          withQuery(`${API}/files`, {
            q: `name=${q(filename)} and ${q(folderId)} in parents and trashed=false and mimeType!=${q(FOLDER_MIME)}`,
            fields: 'files(id,webViewLink)',
            orderBy: 'createdTime',
            pageSize: '1',
            spaces: 'drive',
          }),
          { method: 'GET' },
          token,
        ),
      );
      const found = asRecord((Array.isArray(list.files) ? list.files : [])[0]);
      const id = str(found.id);
      return id ? { id, url: str(found.webViewLink) ?? fileUrl(id) } : null;
    },

    async revoke(refreshToken) {
      const res = await send(deps, REVOKE_URL, {
        method: 'POST',
        headers: formHeaders,
        body: formBody({ token: refreshToken }),
      });
      // 400 invalid_token = already revoked, which is the outcome we wanted.
      if (res.status >= 500) throw new Transient(`Google revoke answered ${res.status}`);
    },

    folderUrl: (folderId) => `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`,
  };
}
