/**
 * Bring-your-own cloud (SHR-7): the contract every storage provider implements, and the typed
 * errors the copy queue acts on. Free of server-only imports so the providers can be unit-tested
 * against a mocked `fetch`.
 */

export const CLOUD_PROVIDERS = ['drive', 'dropbox'] as const;
export type CloudProviderId = (typeof CLOUD_PROVIDERS)[number];

export const isCloudProvider = (value: unknown): value is CloudProviderId =>
  typeof value === 'string' && (CLOUD_PROVIDERS as readonly string[]).includes(value);

/** What the operator sees of a provider: not set up on this server, not linked, linked, or linked but needing a new sign-in. */
export type IntegrationState = 'unavailable' | 'disconnected' | 'connected' | 'needs_reauth';

/** Parts sent to the provider in this size (a multiple of 256 KiB, which Google Drive requires). */
export const CHUNK_BYTES = 8 * 1024 * 1024;

export interface AccessToken {
  token: string;
  expiresAt: Date;
}

export interface CloudFolder {
  /** Drive: the folder id. Dropbox: the folder path (Dropbox addresses folders by path). */
  id: string;
  name: string;
}

export interface CloudFile {
  id: string;
  /** Opens the file in the provider's own web UI, for the operator (never shared with guests). */
  url: string;
}

export type UploadBody = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

export interface CloudProvider {
  readonly id: CloudProviderId;
  /** The consent screen URL. `state` is echoed back to the callback untouched. */
  authorizeUrl(state: string, redirectUri: string): string;
  /** Trade the callback `code` for a long-lived refresh token and the account's email (if readable). */
  exchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; accountEmail: string | null }>;
  /** A short-lived access token. Throws ReauthRequired when the grant was revoked or has expired. */
  accessToken(refreshToken: string): Promise<AccessToken>;
  /** Find or create a folder named `name` under `parentId` (the provider's root when omitted). */
  ensureFolder(token: string, name: string, parentId?: string): Promise<CloudFolder>;
  /**
   * Stream `body` (exactly `size` bytes) into `folderId` as `filename`, in 8 MiB parts, so memory
   * stays flat for any file size. Parts that fail in flight are resent from what the provider
   * reports having received.
   */
  upload(
    token: string,
    folderId: string,
    filename: string,
    mime: string,
    size: number,
    body: UploadBody,
  ): Promise<CloudFile>;
  /** The file already in `folderId` under `filename`, if any (idempotency after a crash). */
  findExisting(token: string, folderId: string, filename: string): Promise<CloudFile | null>;
  /** Best-effort: revoke the grant at the provider. */
  revoke(refreshToken: string): Promise<void>;
  /** A link that opens the folder for the operator. */
  folderUrl(folderId: string): string;
}

/** Base of the typed provider errors; `code` is the stable string stored on the copy row. */
export class CloudError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = new.target.name;
    this.code = code;
  }
}

/** The grant was revoked or expired (Drive/Dropbox `invalid_grant`, or a 401 on a fresh token). */
export class ReauthRequired extends CloudError {
  constructor(message?: string) {
    super('reauth_required', message);
  }
}

/** The operator's cloud is out of space (Drive `storageQuotaExceeded`, Dropbox `insufficient_space`). */
export class QuotaExceeded extends CloudError {
  constructor(message?: string) {
    super('quota_exceeded', message);
  }
}

/** Worth trying again later: network trouble, 5xx, or 429 (then `retryAfterMs` is the provider's ask). */
export class Transient extends CloudError {
  readonly retryAfterMs: number | undefined;
  constructor(message?: string, retryAfterMs?: number) {
    super('transient', message);
    this.retryAfterMs = retryAfterMs;
  }
}

/** Trying again will not help without the operator doing something (`code` says what). */
export class Permanent extends CloudError {
  constructor(code = 'permanent', message?: string) {
    super(code, message);
  }
}
