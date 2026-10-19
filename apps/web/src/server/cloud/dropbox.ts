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
  collect,
  formBody,
  formHeaders,
  partBackoffMs,
  readJson,
  retryAfterMs,
  sanitizeName,
  send,
  str,
  withDeps,
  withQuery,
  type HttpDeps,
} from './util';

/**
 * Dropbox. The narrowest scopes that cover what the copy queue does: read the account's email,
 * create folders, look files up, write files. An "App folder" Dropbox app keeps all of it inside
 * Apps/<app name>, which is the recommended setup.
 */
export const DROPBOX_SCOPES = [
  'account_info.read',
  'files.metadata.read',
  'files.metadata.write',
  'files.content.write',
];

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

export interface DropboxConfig {
  appKey: string;
  appSecret: string;
}

/** The whole upload has to start over (a new session), not just this part. */
class RestartUpload extends Transient {}

/**
 * Dropbox-API-Arg travels in an HTTP header, so anything outside ASCII (accents in an event name)
 * must be written as \uXXXX escapes, which are still valid JSON.
 */
const argHeader = (arg: unknown) =>
  JSON.stringify(arg).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const childPath = (folder: string, name: string) => `${folder.replace(/\/+$/, '')}/${sanitizeName(name)}`;

/** The web UI link: the file's folder with the file open in preview. */
function webUrl(pathDisplay: string): string {
  const slash = pathDisplay.lastIndexOf('/');
  const folder = pathDisplay.slice(0, slash);
  const file = pathDisplay.slice(slash + 1);
  return `https://www.dropbox.com/home${encodeURI(folder)}?preview=${encodeURIComponent(file)}`;
}

/** Map a Dropbox API failure to a typed error. Dropbox names its errors in `error_summary`. */
function dropboxError(res: Response, body: unknown, now: number): CloudError {
  const rec = asRecord(body);
  const summary = str(rec.error_summary) ?? '';
  const detail = summary ? ` (${summary.split('/').slice(0, 2).join('/')})` : '';
  const status = res.status;
  const askedFor = asRecord(rec.error).retry_after;
  const retry = retryAfterMs(res.headers, now) ?? (typeof askedFor === 'number' ? askedFor * 1000 : undefined);
  if (status === 401 || summary.startsWith('missing_scope'))
    return new ReauthRequired(`Dropbox rejected the access token${detail}`);
  if (summary.includes('insufficient_space')) return new QuotaExceeded('The Dropbox is full');
  if (status === 429 || summary.startsWith('too_many_'))
    return new Transient(`Dropbox is rate limiting${detail}`, retry);
  if (status >= 500) return new Transient(`Dropbox answered ${status}${detail}`, retry);
  if (summary.includes('path/not_found'))
    return new Permanent('folder_missing', `Dropbox could not find the folder${detail}`);
  if (summary.includes('no_write_permission'))
    return new Permanent('folder_inaccessible', `Immersia cannot write there${detail}`);
  if (summary.includes('disallowed_name') || summary.includes('malformed_path'))
    return new Permanent('bad_name', `Dropbox refused the name${detail}`);
  if (status === 403) return new Permanent('forbidden', `Dropbox refused the request${detail}`);
  return new Permanent(`http_${status}`, `Dropbox answered ${status}${detail}`);
}

export function dropbox(config: DropboxConfig, overrides?: Partial<HttpDeps>): CloudProvider {
  const deps = withDeps(overrides);
  const basic = `Basic ${Buffer.from(`${config.appKey}:${config.appSecret}`).toString('base64')}`;

  /** An RPC-style call: JSON in, JSON out. Returns the response so callers can read 409s themselves. */
  async function api(token: string, endpoint: string, args?: unknown) {
    const res = await send(deps, `${API}/${endpoint}`, {
      method: 'POST',
      // Endpoints without arguments must be sent with no body and no content type at all.
      headers:
        args === undefined
          ? { authorization: `Bearer ${token}` }
          : { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(args === undefined ? {} : { body: JSON.stringify(args) }),
    });
    return { res, body: await readJson(res) };
  }

  /** A content-upload call: arguments in a header, the bytes as the body. */
  async function content(token: string, endpoint: string, arg: unknown, data: Uint8Array<ArrayBuffer>) {
    const res = await send(
      deps,
      `${CONTENT}/${endpoint}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/octet-stream',
          'dropbox-api-arg': argHeader(arg),
        },
        body: data,
      },
      120_000,
    );
    return { res, body: await readJson(res) };
  }

  async function tokenRequest(params: Record<string, string>, onBadGrant: () => CloudError, failCode: string) {
    const res = await send(deps, TOKEN_URL, {
      method: 'POST',
      headers: { ...formHeaders, authorization: basic },
      body: formBody(params),
    });
    const body = asRecord(await readJson(res));
    if (res.ok) return body;
    const code = str(body.error);
    if (code === 'invalid_grant') throw onBadGrant();
    if (code === 'invalid_client' || code === 'unauthorized_client')
      throw new Permanent('provider_config', 'The Dropbox app credentials are not set up correctly');
    if (res.status === 429 || res.status >= 500)
      throw new Transient(`Dropbox sign-in answered ${res.status}`, retryAfterMs(res.headers, deps.now()));
    throw new Permanent(failCode, `Dropbox sign-in answered ${res.status}${code ? ` (${code})` : ''}`);
  }

  const toFile = (body: unknown): CloudFile => {
    const rec = asRecord(body);
    const id = str(rec.id);
    const path = str(rec.path_display);
    if (!id || !path) throw new Transient('Dropbox did not return the new file');
    return { id, url: webUrl(path) };
  };

  async function find(token: string, folderId: string, filename: string): Promise<CloudFile | null> {
    const { res, body } = await api(token, 'files/get_metadata', { path: childPath(folderId, filename) });
    if (res.ok) return asRecord(body)['.tag'] === 'file' ? toFile(body) : null;
    if (res.status === 409 && (str(asRecord(body).error_summary) ?? '').startsWith('path/not_found')) return null;
    throw dropboxError(res, body, deps.now());
  }

  /** Run one part's request, resending it if the connection or Dropbox hiccups. */
  async function withPartRetries<T>(op: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await op();
      } catch (err) {
        if (!(err instanceof Transient) || err instanceof RestartUpload || attempt >= PART_RETRIES) throw err;
        await deps.sleep(Math.max(partBackoffMs(attempt), err.retryAfterMs ?? 0));
      }
    }
  }

  /** `correct_offset` sits at the top of an append error and under `lookup_failed` in a finish error. */
  function correctOffset(body: unknown): number | undefined {
    const error = asRecord(asRecord(body).error);
    const n = error.correct_offset ?? asRecord(error.lookup_failed).correct_offset;
    return typeof n === 'number' ? n : undefined;
  }

  async function accessToken(refreshToken: string): Promise<AccessToken> {
    const body = await tokenRequest(
      { refresh_token: refreshToken, grant_type: 'refresh_token' },
      () => new ReauthRequired('Dropbox no longer accepts this connection'),
      'token_failed',
    );
    const token = str(body.access_token);
    if (!token) throw new Transient('Dropbox did not return an access token');
    const seconds = typeof body.expires_in === 'number' ? body.expires_in : 14_400;
    return { token, expiresAt: new Date(deps.now() + seconds * 1000) };
  }

  return {
    id: 'dropbox',

    authorizeUrl(state, redirectUri) {
      return withQuery(AUTH_URL, {
        client_id: config.appKey,
        redirect_uri: redirectUri,
        response_type: 'code',
        // `offline` is what makes Dropbox return a refresh token instead of a 4-hour access token.
        token_access_type: 'offline',
        scope: DROPBOX_SCOPES.join(' '),
        state,
      });
    },

    async exchangeCode(code, redirectUri) {
      const body = await tokenRequest(
        { code, redirect_uri: redirectUri, grant_type: 'authorization_code' },
        () => new Permanent('exchange_failed', 'Dropbox rejected the authorization code'),
        'exchange_failed',
      );
      const refreshToken = str(body.refresh_token);
      if (!refreshToken) throw new Permanent('no_refresh_token', 'Dropbox did not return a refresh token');
      const granted = (str(body.scope) ?? '').split(' ');
      if (!DROPBOX_SCOPES.every((s) => granted.includes(s)))
        throw new Permanent('scope_missing', 'Dropbox access was not fully granted');
      let accountEmail: string | null = null;
      const access = str(body.access_token);
      if (access) {
        const { res, body: account } = await api(access, 'users/get_current_account');
        // The email is only a label; a connection without one is still a connection.
        if (res.ok) accountEmail = str(asRecord(account).email) ?? null;
      }
      return { refreshToken, accountEmail };
    },

    accessToken,

    async ensureFolder(token, name, parentId): Promise<CloudFolder> {
      const path = childPath(parentId ?? '', name);
      const { res, body } = await api(token, 'files/create_folder_v2', { path, autorename: false });
      if (res.ok) {
        const meta = asRecord(asRecord(body).metadata);
        return { id: str(meta.path_display) ?? path, name: str(meta.name) ?? name };
      }
      if (res.status === 409 && (str(asRecord(body).error_summary) ?? '').includes('path/conflict')) {
        // Already there (or a file is in the way): confirm it is a folder.
        const existing = await api(token, 'files/get_metadata', { path });
        const meta = asRecord(existing.body);
        if (existing.res.ok && meta['.tag'] === 'folder')
          return { id: str(meta.path_display) ?? path, name: str(meta.name) ?? name };
        if (existing.res.ok) throw new Permanent('bad_name', 'A file with that name is in the way');
        throw dropboxError(existing.res, existing.body, deps.now());
      }
      throw dropboxError(res, body, deps.now());
    },

    async upload(token, folderId, filename, _mime, size, source: UploadBody): Promise<CloudFile> {
      const path = childPath(folderId, filename);
      // Never overwrite and never rename: a name clash means the file is already there.
      const commit = { path, mode: 'add', autorename: false, mute: true };
      const alreadyThere = async (): Promise<CloudFile | null> => find(token, folderId, filename);

      if (size <= CHUNK_BYTES) {
        const data = await collect(source, size);
        if (!data || data.length !== size) throw new Transient('The source length did not match the expected size');
        const { res, body } = await content(token, 'files/upload', commit, data);
        if (res.ok) return toFile(body);
        if (res.status === 409 && (str(asRecord(body).error_summary) ?? '').includes('path/conflict')) {
          const existing = await alreadyThere();
          if (existing) return existing;
          throw new Permanent('conflict', 'Something else is already saved under that name');
        }
        throw dropboxError(res, body, deps.now());
      }

      let offset = 0;
      let sessionId: string | undefined;
      let file: CloudFile | undefined;
      for await (const part of chunked(source, CHUNK_BYTES)) {
        if (offset + part.length > size) throw new Transient('The source is longer than expected');
        const last = offset + part.length === size;
        if (!sessionId) {
          sessionId = await withPartRetries(async () => {
            const { res, body } = await content(token, 'files/upload_session/start', { close: false }, part);
            if (!res.ok) throw dropboxError(res, body, deps.now());
            const id = str(asRecord(body).session_id);
            if (!id) throw new Transient('Dropbox did not open an upload session');
            return id;
          });
        } else if (!last) {
          const id = sessionId;
          await withPartRetries(async () => {
            const { res, body } = await content(
              token,
              'files/upload_session/append_v2',
              { cursor: { session_id: id, offset }, close: false },
              part,
            );
            if (res.ok) return;
            const summary = str(asRecord(body).error_summary) ?? '';
            if (res.status === 409 && summary.includes('incorrect_offset')) {
              // An earlier attempt of this very part had landed; anything else means we are out of step.
              if (correctOffset(body) === offset + part.length) return;
              throw new RestartUpload('The upload and Dropbox disagree about the offset');
            }
            if (res.status === 409 && summary.includes('not_found'))
              throw new RestartUpload('The upload session expired');
            throw dropboxError(res, body, deps.now());
          });
        } else {
          const id = sessionId;
          file = await withPartRetries(async () => {
            const { res, body } = await content(
              token,
              'files/upload_session/finish',
              { cursor: { session_id: id, offset }, commit },
              part,
            );
            if (res.ok) return toFile(body);
            const summary = str(asRecord(body).error_summary) ?? '';
            if (res.status === 409 && (summary.includes('path/conflict') || summary.startsWith('lookup_failed'))) {
              // The commit may have gone through before a lost response: if the file is there, we are done.
              const existing = await alreadyThere();
              if (existing) return existing;
              if (summary.startsWith('lookup_failed')) throw new RestartUpload('The upload session is gone');
              throw new Permanent('conflict', 'Something else is already saved under that name');
            }
            throw dropboxError(res, body, deps.now());
          });
        }
        offset += part.length;
      }
      if (offset !== size) throw new Transient('The source ended before the expected size');
      if (!file) throw new Transient('Dropbox did not confirm the upload');
      return file;
    },

    findExisting: find,

    async revoke(refreshToken) {
      let token: string;
      try {
        token = (await accessToken(refreshToken)).token;
      } catch (err) {
        if (err instanceof ReauthRequired) return; // already revoked, which is what we wanted
        throw err;
      }
      const { res } = await api(token, 'auth/token/revoke');
      if (res.status >= 500) throw new Transient(`Dropbox revoke answered ${res.status}`);
    },

    folderUrl: (folderId) => `https://www.dropbox.com/home${encodeURI(folderId)}`,
  };
}
