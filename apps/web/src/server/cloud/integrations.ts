import 'server-only';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { uuidv7 } from '@immersia/shared';
import { CryptoBoxError, open, seal } from '../crypto-box';
import { DEFAULT_CLOUD_FOLDER, cloudFilename } from '../filenames';
import type { Operator } from '../session';
import { availability, cloudProvider, integrationKey, redirectUri, stateSecret, type Availability } from './config';
import { copyErrorKey, type CopyErrorKey } from './copy-core';
import { signOAuthState, verifyOAuthState } from './oauth-state';
import {
  CLOUD_PROVIDERS,
  CloudError,
  Permanent,
  QuotaExceeded,
  ReauthRequired,
  Transient,
  type CloudProviderId,
  type IntegrationState,
} from './providers';
import { sanitizeName } from './util';

const { integration, uploadObject, output, captureSession, event } = schema;

/**
 * The operator's connected clouds (SHR-7, screen 20): the OAuth connect flow, the encrypted refresh
 * token, folder choice and the status transitions. Tokens never leave this module in the clear: the
 * views below carry no token field at all.
 */

/** The refresh token is bound to its row, so a copy of it on another organization's row won't open. */
const aad = (organizationId: string, provider: CloudProviderId) => `${organizationId}:${provider}`;

/** Decrypt a stored refresh token. A value we cannot open is as good as revoked: the operator reconnects. */
export function openRefreshToken(sealed: string, organizationId: string, provider: CloudProviderId): string {
  const key = integrationKey();
  if (!key || !sealed) throw new ReauthRequired('There is no stored token to use');
  try {
    return open(sealed, key, aad(organizationId, provider));
  } catch (err) {
    if (err instanceof CryptoBoxError) throw new ReauthRequired('The stored token could not be opened');
    throw err;
  }
}

export interface IntegrationView {
  provider: CloudProviderId;
  availability: Availability;
  state: IntegrationState;
  accountEmail: string | null;
  folderName: string | null;
  /** Opens the folder in the provider's own web UI. */
  folderUrl: string | null;
  lastError: string | null;
}

/** Both providers, in a fixed order, with this organization's connection (if any). Never includes tokens. */
export async function loadIntegrations(organizationId: string): Promise<IntegrationView[]> {
  const rows = await db()
    .select({
      provider: integration.provider,
      status: integration.status,
      accountEmail: integration.accountEmail,
      folderId: integration.folderId,
      folderName: integration.folderName,
      lastError: integration.lastError,
    })
    .from(integration)
    .where(eq(integration.organizationId, organizationId));
  return CLOUD_PROVIDERS.map((provider): IntegrationView => {
    const found = rows.find((r) => r.provider === provider);
    const row = found && found.status !== 'revoked' ? found : undefined;
    const avail = availability(provider);
    const state: IntegrationState =
      avail !== 'available'
        ? 'unavailable'
        : !row
          ? 'disconnected'
          : row.status === 'needs_reauth'
            ? 'needs_reauth'
            : 'connected';
    return {
      provider,
      availability: avail,
      state,
      accountEmail: row?.accountEmail ?? null,
      folderName: row?.folderName ?? null,
      folderUrl: row?.folderId ? (cloudProvider(provider)?.folderUrl(row.folderId) ?? null) : null,
      lastError: row?.lastError ?? null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Connect flow

/** The provider's consent URL for this operator, or null when this server is not set up for it. */
export function beginConnect(op: Operator, provider: CloudProviderId): string | null {
  const p = cloudProvider(provider);
  if (!p) return null;
  const state = signOAuthState({ org: op.organizationId, user: op.userId, provider }, stateSecret());
  return p.authorizeUrl(state, redirectUri(provider));
}

/** Why a connection did not complete: the `error` code on /studio/integrations. */
export type ConnectError = 'unavailable' | 'state' | 'scope' | 'no_refresh' | 'exchange' | 'unreachable' | 'failed';

/**
 * Finish the connection at the OAuth callback. The state must be genuine, unexpired and bound to
 * this very operator, organization and provider; only then is the code exchanged and the refresh
 * token stored (encrypted, one row per organization and provider).
 */
export async function completeConnect(
  op: Operator,
  provider: CloudProviderId,
  params: { code: string; state: string },
): Promise<{ ok: true } | { ok: false; error: ConnectError }> {
  const claims = verifyOAuthState(params.state, stateSecret());
  if (!claims || claims.provider !== provider || claims.user !== op.userId || claims.org !== op.organizationId)
    return { ok: false, error: 'state' };
  const p = cloudProvider(provider);
  const key = integrationKey();
  if (!p || !key) return { ok: false, error: 'unavailable' };

  let granted: { refreshToken: string; accountEmail: string | null };
  try {
    granted = await p.exchangeCode(params.code, redirectUri(provider));
  } catch (err) {
    if (err instanceof Permanent) {
      if (err.code === 'scope_missing') return { ok: false, error: 'scope' };
      if (err.code === 'no_refresh_token') return { ok: false, error: 'no_refresh' };
      if (err.code === 'provider_config') return { ok: false, error: 'unavailable' };
      return { ok: false, error: 'exchange' };
    }
    if (err instanceof Transient) return { ok: false, error: 'unreachable' };
    console.error('[integrations] code exchange failed', err instanceof CloudError ? err.code : 'unexpected');
    return { ok: false, error: 'failed' };
  }

  const [existing] = await db()
    .select({
      status: integration.status,
      accountEmail: integration.accountEmail,
      folderId: integration.folderId,
      folderName: integration.folderName,
    })
    .from(integration)
    .where(and(eq(integration.organizationId, op.organizationId), eq(integration.provider, provider)))
    .limit(1);

  // Reconnecting the same account keeps its folder. A new account (or one whose email we could not
  // read) gets the default folder, found or created: the app only sees folders it made itself.
  let folder: { id: string; name: string } | null =
    existing?.status !== 'revoked' &&
    existing?.folderId &&
    existing.accountEmail &&
    existing.accountEmail === granted.accountEmail
      ? { id: existing.folderId, name: existing.folderName ?? DEFAULT_CLOUD_FOLDER }
      : null;
  if (!folder) {
    try {
      const access = await p.accessToken(granted.refreshToken);
      folder = await p.ensureFolder(access.token, DEFAULT_CLOUD_FOLDER);
    } catch {
      // Connected without a folder: the first copy (or the folder form) creates it.
      folder = null;
    }
  }

  const values = {
    encryptedRefreshToken: seal(granted.refreshToken, key, aad(op.organizationId, provider)),
    accountEmail: granted.accountEmail,
    folderId: folder?.id ?? null,
    folderName: folder?.name ?? null,
    status: 'connected' as const,
    lastError: null,
    updatedAt: new Date(),
  };
  await db()
    .insert(integration)
    .values({ id: uuidv7(), organizationId: op.organizationId, provider, ...values })
    .onConflictDoUpdate({ target: [integration.organizationId, integration.provider], set: values });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Status transitions

/** The cloud stopped accepting our access: copies wait (nothing is dropped) until the operator reconnects. */
export async function markNeedsReauth(integrationId: string, code = 'reauth_required'): Promise<void> {
  await db()
    .update(integration)
    .set({ status: 'needs_reauth', lastError: code, updatedAt: new Date() })
    .where(and(eq(integration.id, integrationId), eq(integration.status, 'connected')));
}

export type FolderError = 'not_connected' | 'reauth_required' | 'quota_exceeded' | 'unreachable' | 'failed';

/**
 * Point copies at a folder named `name` at the top of the operator's cloud (created if it isn't
 * there). Files already copied stay where they are; new copies go to the new folder.
 */
export async function chooseFolder(
  organizationId: string,
  provider: CloudProviderId,
  name: string,
): Promise<{ ok: true; folderName: string } | { ok: false; error: FolderError }> {
  const folderName = sanitizeName(name.trim(), 80);
  const [row] = await db()
    .select({ id: integration.id, status: integration.status, token: integration.encryptedRefreshToken })
    .from(integration)
    .where(and(eq(integration.organizationId, organizationId), eq(integration.provider, provider)))
    .limit(1);
  const p = cloudProvider(provider);
  if (!row || row.status === 'revoked' || !p) return { ok: false, error: 'not_connected' };
  try {
    const access = await p.accessToken(openRefreshToken(row.token, organizationId, provider));
    const folder = await p.ensureFolder(access.token, folderName);
    await db()
      .update(integration)
      .set({ folderId: folder.id, folderName: folder.name, updatedAt: new Date() })
      .where(eq(integration.id, row.id));
    return { ok: true, folderName: folder.name };
  } catch (err) {
    if (err instanceof ReauthRequired) {
      await markNeedsReauth(row.id);
      return { ok: false, error: 'reauth_required' };
    }
    if (err instanceof QuotaExceeded) return { ok: false, error: 'quota_exceeded' };
    if (err instanceof Transient) return { ok: false, error: 'unreachable' };
    console.error('[integrations] choosing a folder failed', err instanceof CloudError ? err.code : 'unexpected');
    return { ok: false, error: 'failed' };
  }
}

/**
 * Disconnect: revoke the grant at the provider (best effort: if it is unreachable, or already
 * revoked, the connection is dropped here all the same) and delete the encrypted token.
 */
export async function disconnect(organizationId: string, provider: CloudProviderId): Promise<boolean> {
  const [row] = await db()
    .select({ id: integration.id, status: integration.status, token: integration.encryptedRefreshToken })
    .from(integration)
    .where(and(eq(integration.organizationId, organizationId), eq(integration.provider, provider)))
    .limit(1);
  if (!row || row.status === 'revoked') return false;
  const p = cloudProvider(provider);
  if (p && row.token) {
    try {
      await p.revoke(openRefreshToken(row.token, organizationId, provider));
    } catch {
      // Best effort by design.
    }
  }
  await db()
    .update(integration)
    .set({
      encryptedRefreshToken: '',
      status: 'revoked',
      accountEmail: null,
      folderId: null,
      folderName: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(integration.id, row.id));
  return true;
}

// ---------------------------------------------------------------------------------------------
// Read models: the copies list on screen 20 and the warning on the event dashboard

export interface CopyView {
  id: string;
  provider: CloudProviderId;
  status: (typeof uploadObject.$inferSelect)['status'];
  fileName: string;
  eventId: string;
  eventName: string;
  errorKey: CopyErrorKey | null;
  attempts: number;
  remoteUrl: string | null;
  createdAt: Date;
  completedAt: Date | null;
  nextAttemptAt: Date | null;
}

/** How many other outputs of the same kind the session has (the filename needs it to stay unique). */
const sameKindOf =
  sql<number>`(select count(*) from ${output} o2 where o2.session_id = ${output.sessionId} and o2.kind = ${output.kind})`.mapWith(
    Number,
  );

/** The latest copies to the operator's clouds, newest first. */
export async function recentCopies(organizationId: string, limit = 20): Promise<CopyView[]> {
  const rows = await db()
    .select({
      id: uploadObject.id,
      target: uploadObject.target,
      status: uploadObject.status,
      lastError: uploadObject.lastError,
      attempts: uploadObject.attempts,
      remoteUrl: uploadObject.remoteUrl,
      createdAt: uploadObject.createdAt,
      completedAt: uploadObject.completedAt,
      nextAttemptAt: uploadObject.nextAttemptAt,
      outputId: output.id,
      kind: output.kind,
      mime: output.mime,
      shortCode: captureSession.shortCode,
      prefix: captureSession.filenamePrefix,
      eventId: event.id,
      eventName: event.name,
      sameKind: sameKindOf,
    })
    .from(uploadObject)
    .innerJoin(output, eq(output.id, uploadObject.outputId))
    .innerJoin(captureSession, eq(captureSession.id, output.sessionId))
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(and(eq(event.organizationId, organizationId), inArray(uploadObject.target, ['drive', 'dropbox'])))
    .orderBy(desc(uploadObject.createdAt))
    .limit(limit);
  return rows.flatMap((r): CopyView[] =>
    r.target === 'hosted'
      ? []
      : [
          {
            id: r.id,
            provider: r.target,
            status: r.status,
            fileName: cloudFilename(r),
            eventId: r.eventId,
            eventName: r.eventName,
            errorKey: copyErrorKey(r.lastError),
            attempts: r.attempts,
            remoteUrl: r.remoteUrl,
            createdAt: r.createdAt,
            completedAt: r.completedAt,
            nextAttemptAt: r.nextAttemptAt,
          },
        ],
  );
}

export interface CopyBacklog {
  /** Copies still to do (pending or in progress). */
  waiting: number;
  failed: number;
  /** The reason most failed copies share, when there are any. */
  failedKey: CopyErrorKey | null;
}

/** Waiting and failed copies, optionally for one event. */
export async function copyBacklog(
  organizationId: string,
  provider: CloudProviderId,
  eventId?: string,
): Promise<CopyBacklog> {
  const rows = await db()
    .select({ status: uploadObject.status, code: uploadObject.lastError, n: count() })
    .from(uploadObject)
    .innerJoin(output, eq(output.id, uploadObject.outputId))
    .innerJoin(captureSession, eq(captureSession.id, output.sessionId))
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(
      and(
        eq(event.organizationId, organizationId),
        eventId ? eq(event.id, eventId) : undefined,
        eq(uploadObject.target, provider),
        inArray(uploadObject.status, ['pending', 'uploading', 'failed']),
      ),
    )
    .groupBy(uploadObject.status, uploadObject.lastError);
  let waiting = 0;
  let failed = 0;
  const byCode = new Map<string | null, number>();
  for (const r of rows) {
    if (r.status === 'failed') {
      failed += r.n;
      byCode.set(r.code, (byCode.get(r.code) ?? 0) + r.n);
    } else waiting += r.n;
  }
  const top = [...byCode.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { waiting, failed, failedKey: copyErrorKey(top) ?? (failed > 0 ? 'other' : null) };
}

export interface EventCloudAlert {
  provider: CloudProviderId;
  /** `needs_reauth`: reconnect. `disconnected`: connect again. `failed`: some copies need attention. */
  reason: 'needs_reauth' | 'disconnected' | 'failed';
  waiting: number;
  failed: number;
  failedKey: CopyErrorKey | null;
}

/**
 * HLP-3 on the event dashboard: when the event copies to a cloud that needs the operator (the
 * connection lapsed, or some copies failed), what is wrong. Null when everything is fine or the
 * event doesn't copy anywhere.
 */
export async function eventCloudAlert(organizationId: string, eventId: string): Promise<EventCloudAlert | null> {
  const [ev] = await db()
    .select({ cloud: sql<string | null>`${event.shareSettings}->>'cloud'` })
    .from(event)
    .where(and(eq(event.id, eventId), eq(event.organizationId, organizationId)))
    .limit(1);
  const provider = CLOUD_PROVIDERS.find((p) => p === ev?.cloud);
  if (!provider) return null;
  const [[row], counts] = await Promise.all([
    db()
      .select({ status: integration.status })
      .from(integration)
      .where(and(eq(integration.organizationId, organizationId), eq(integration.provider, provider)))
      .limit(1),
    copyBacklog(organizationId, provider, eventId),
  ]);
  const reason: EventCloudAlert['reason'] | null =
    !row || row.status === 'revoked'
      ? 'disconnected'
      : row.status === 'needs_reauth'
        ? 'needs_reauth'
        : counts.failed > 0
          ? 'failed'
          : null;
  return reason ? { provider, reason, ...counts } : null;
}
