import 'server-only';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, ne, notExists, notInArray, or, sql } from 'drizzle-orm';
import { db, schema, type Transaction } from '@immersia/db';
import { uuidv7 } from '@immersia/shared';
import { DEFAULT_CLOUD_FOLDER, cloudFilename, eventFolderName } from '../filenames';
import { isMissingObject, objectStream } from '../storage';
import { cloudProvider } from './config';
import { LEASE_MS, MAX_ATTEMPTS, copyToCloud, decideFailure, type Decision } from './copy-core';
import { markNeedsReauth, openRefreshToken } from './integrations';
import {
  CLOUD_PROVIDERS,
  CloudError,
  Permanent,
  type AccessToken,
  type CloudProvider,
  type CloudProviderId,
} from './providers';

const { event, captureSession, output, uploadObject, integration } = schema;

/**
 * Copies of finished outputs to the operator's own cloud (SHR-7). The booth uploads once, to our
 * hosted storage; this queue then streams each file from there to Drive or Dropbox, server to
 * server. Rows in `upload_object` are the queue: the key `outputId:target` makes enqueueing
 * idempotent, a claim with a lease (FOR UPDATE SKIP LOCKED) lets many workers share it without
 * stepping on each other, and the file name in the operator's folder is the identity that makes a
 * retry after a crash find the file instead of uploading it twice. Hosted files are never touched.
 */

/**
 * `share_settings.cloud` of the event the output belongs to. Parenthesised: `->>` and `||` share a
 * precedence level in Postgres, so inside `a || b || cloud` it would otherwise apply to the whole concatenation.
 */
const cloudOf = sql<CloudProviderId | 'none' | null>`(${event.shareSettings}->>'cloud')`;

const isProvider = (v: unknown): v is CloudProviderId => (CLOUD_PROVIDERS as readonly unknown[]).includes(v);

// ---------------------------------------------------------------------------------------------
// Enqueue

/**
 * After a hosted upload completes: queue the copy when the event copies to a cloud the organization
 * has linked. A linked cloud that needs re-authorization still gets the row — the file waits safely
 * and is copied once the operator reconnects (acceptance #6) — only a disconnected one does not.
 */
export async function enqueueCloudCopies(outputId: string): Promise<number> {
  const [row] = await db()
    .select({
      target: cloudOf,
      uploadedAt: output.uploadedAt,
      organizationId: event.organizationId,
      expiredAt: captureSession.expiredAt,
    })
    .from(output)
    .innerJoin(captureSession, eq(captureSession.id, output.sessionId))
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(eq(output.id, outputId))
    .limit(1);
  if (!row?.uploadedAt || row.expiredAt || !isProvider(row.target)) return 0;
  const target = row.target;
  const [linked] = await db()
    .select({ status: integration.status })
    .from(integration)
    .where(and(eq(integration.organizationId, row.organizationId), eq(integration.provider, target)))
    .limit(1);
  if (!linked || linked.status === 'revoked') return 0;
  const inserted = await db()
    .insert(uploadObject)
    .values({ id: uuidv7(), outputId, target, idempotencyKey: `${outputId}:${target}` })
    .onConflictDoNothing()
    .returning({ id: uploadObject.id });
  return inserted.length;
}

/**
 * The safety net behind enqueueCloudCopies: queue every uploaded, unexpired output of an event that
 * copies to a linked cloud and has no row yet. Covers a worker that died before enqueueing, and
 * files that arrived while the cloud was disconnected, once it is connected again. Idempotent.
 */
export async function enqueueMissingCopies(
  scope: { organizationId?: string; provider?: CloudProviderId } = {},
  batch = 500,
): Promise<number> {
  let total = 0;
  for (let pass = 0; pass < 20; pass++) {
    const rows = await db()
      .select({ outputId: output.id, target: cloudOf })
      .from(output)
      .innerJoin(captureSession, eq(captureSession.id, output.sessionId))
      .innerJoin(event, eq(event.id, captureSession.eventId))
      .innerJoin(
        integration,
        and(eq(integration.organizationId, event.organizationId), sql`${integration.provider}::text = ${cloudOf}`),
      )
      .where(
        and(
          isNotNull(output.uploadedAt),
          isNull(captureSession.expiredAt),
          gt(captureSession.expiresAt, new Date()),
          ne(integration.status, 'revoked'),
          scope.organizationId ? eq(event.organizationId, scope.organizationId) : undefined,
          scope.provider ? eq(integration.provider, scope.provider) : undefined,
          notExists(
            db()
              .select({ one: sql`1` })
              .from(uploadObject)
              .where(sql`${uploadObject.idempotencyKey} = ${output.id}::text || ':' || ${cloudOf}`),
          ),
        ),
      )
      .limit(batch);
    const values = rows.flatMap((r) =>
      isProvider(r.target)
        ? [{ id: uuidv7(), outputId: r.outputId, target: r.target, idempotencyKey: `${r.outputId}:${r.target}` }]
        : [],
    );
    if (!values.length) break;
    const inserted = await db()
      .insert(uploadObject)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: uploadObject.id });
    total += inserted.length;
    if (rows.length < batch || !inserted.length) break;
  }
  return total;
}

// ---------------------------------------------------------------------------------------------
// Claim and process

interface ClaimedCopy {
  id: string;
  target: CloudProviderId;
  /** Including this try. */
  attempts: number;
  outputId: string;
  objectKey: string | null;
  mime: string;
  kind: string;
  uploadedAt: Date | null;
  shortCode: string;
  prefix: string;
  sameKind: number;
  expiredAt: Date | null;
  eventId: string;
  eventName: string;
  eventDate: string;
  organizationId: string;
  integrationId: string;
  sealedToken: string;
  folderId: string | null;
}

/**
 * Take the oldest due row, if any: pending (or a lapsed claim) whose integration is connected and not
 * in `skip`. FOR UPDATE SKIP LOCKED makes concurrent workers pick different rows; the lease in
 * `next_attempt_at` keeps the claim after the transaction ends, so a worker that dies mid-upload
 * only delays the row until the lease runs out.
 */
async function claimNext(skip: string[]): Promise<ClaimedCopy | null> {
  return db().transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .select({
        id: uploadObject.id,
        target: uploadObject.target,
        attempts: uploadObject.attempts,
        outputId: output.id,
        objectKey: output.objectKey,
        mime: output.mime,
        kind: output.kind,
        uploadedAt: output.uploadedAt,
        shortCode: captureSession.shortCode,
        prefix: captureSession.filenamePrefix,
        sameKind:
          sql<number>`(select count(*) from ${output} o2 where o2.session_id = ${output.sessionId} and o2.kind = ${output.kind})`.mapWith(
            Number,
          ),
        expiredAt: captureSession.expiredAt,
        eventId: event.id,
        eventName: event.name,
        eventDate: event.date,
        organizationId: event.organizationId,
        integrationId: integration.id,
        sealedToken: integration.encryptedRefreshToken,
        folderId: integration.folderId,
      })
      .from(uploadObject)
      .innerJoin(output, eq(output.id, uploadObject.outputId))
      .innerJoin(captureSession, eq(captureSession.id, output.sessionId))
      .innerJoin(event, eq(event.id, captureSession.eventId))
      .innerJoin(
        integration,
        and(
          eq(integration.organizationId, event.organizationId),
          sql`${integration.provider}::text = ${uploadObject.target}::text`,
        ),
      )
      .where(
        and(
          inArray(uploadObject.target, ['drive', 'dropbox']),
          inArray(uploadObject.status, ['pending', 'uploading']),
          or(isNull(uploadObject.nextAttemptAt), lte(uploadObject.nextAttemptAt, now)),
          eq(integration.status, 'connected'),
          skip.length ? notInArray(integration.id, skip) : undefined,
        ),
      )
      .orderBy(asc(uploadObject.createdAt))
      .limit(1)
      .for('update', { of: uploadObject, skipLocked: true });
    if (!row || row.target === 'hosted') return null;
    const [claimed] = await tx
      .update(uploadObject)
      .set({
        status: 'uploading',
        attempts: sql`${uploadObject.attempts} + 1`,
        nextAttemptAt: new Date(now.getTime() + LEASE_MS),
      })
      .where(eq(uploadObject.id, row.id))
      .returning({ attempts: uploadObject.attempts });
    return { ...row, target: row.target, attempts: claimed?.attempts ?? row.attempts + 1 };
  });
}

/** Hold a Postgres advisory lock for the length of `fn`, so two workers don't both create the same folder. */
async function withLock<T>(key: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    return fn(tx);
  });
}

export interface CopyRunStats {
  claimed: number;
  done: number;
  /** Of `done`, files that were already in the operator's folder (a previous attempt had finished). */
  reused: number;
  retried: number;
  failed: number;
  /** Rows paused because the operator has to reconnect. */
  paused: number;
}

/** What one run remembers, so a batch of files does one token refresh and one folder lookup per event. */
interface Run {
  tokens: Map<string, AccessToken>;
  folders: Map<string, string>;
  /** Integrations not worth trying again in this run (reconnect needed, or the cloud is full). */
  skip: Set<string>;
  stats: CopyRunStats;
}

/**
 * Copy up to `limit` due files, for at most `budgetMs` (callers run inside a function with a time
 * limit). Safe to call from many places at once: after each upload, from the cron sweep.
 */
export async function processCloudCopies(limit = 5, budgetMs = 240_000): Promise<CopyRunStats> {
  const run: Run = {
    tokens: new Map(),
    folders: new Map(),
    skip: new Set(),
    stats: { claimed: 0, done: 0, reused: 0, retried: 0, failed: 0, paused: 0 },
  };
  const deadline = Date.now() + budgetMs;
  while (run.stats.claimed < limit && Date.now() < deadline) {
    const job = await claimNext([...run.skip]);
    if (!job) break;
    run.stats.claimed++;
    await processOne(job, run);
  }
  return run.stats;
}

async function processOne(job: ClaimedCopy, run: Run): Promise<void> {
  const provider = cloudProvider(job.target);
  if (!provider) {
    // The server lost its credentials: leave the row for when they are back.
    await settle(job, run, { kind: 'retry', code: 'transient', at: new Date(Date.now() + 10 * 60_000) }, false);
    run.skip.add(job.integrationId);
    return;
  }
  try {
    if (!job.objectKey || !job.uploadedAt || job.expiredAt) throw new Permanent('source_gone');
    // A row that keeps killing its worker (an oversized file, say) must not be claimed forever.
    if (job.attempts > MAX_ATTEMPTS) throw new Permanent('transient');
    const token = await tokenFor(job, provider, run);
    const root = await rootFolder(job, provider, token);
    const folder = await eventFolderFor(job, provider, token, root, run);
    const key = job.objectKey;
    const { file, reused } = await copyToCloud(
      provider,
      {
        token,
        folderId: folder,
        filename: cloudFilename({ ...job }),
        mime: job.mime,
      },
      async () => {
        try {
          return await objectStream(key);
        } catch (err) {
          if (isMissingObject(err)) throw new Permanent('source_gone'); // expired and deleted meanwhile
          throw err;
        }
      },
    );
    await db()
      .update(uploadObject)
      .set({
        status: 'done',
        remoteId: file.id,
        remoteUrl: file.url,
        lastError: null,
        nextAttemptAt: null,
        completedAt: new Date(),
      })
      // Only our own claim: a row deleted by a disconnect meanwhile stays gone.
      .where(and(eq(uploadObject.id, job.id), eq(uploadObject.status, 'uploading')));
    run.stats.done++;
    if (reused) run.stats.reused++;
  } catch (err) {
    const decision = decideFailure(err, job.attempts, new Date());
    // Only our own error messages are logged (they carry no tokens or provider payloads); anything
    // unexpected is reduced to its type.
    const why = err instanceof CloudError ? err.message : err instanceof Error ? err.name : typeof err;
    console.warn('[cloud-copy]', job.id, job.target, decision.kind, why);
    await settle(job, run, decision, true);
  }
}

/** Write the outcome of a failed attempt to the row. */
async function settle(job: ClaimedCopy, run: Run, decision: Decision, counted: boolean): Promise<void> {
  const mine = and(eq(uploadObject.id, job.id), eq(uploadObject.status, 'uploading'));
  if (decision.kind === 'retry') {
    await db()
      .update(uploadObject)
      .set({
        status: 'pending',
        lastError: decision.code,
        nextAttemptAt: decision.at,
        // A try that never really ran (no credentials) doesn't count against the file.
        ...(counted ? {} : { attempts: sql`greatest(${uploadObject.attempts} - 1, 0)` }),
      })
      .where(mine);
    if (counted) run.stats.retried++;
  } else if (decision.kind === 'fail') {
    await db()
      .update(uploadObject)
      .set({ status: 'failed', lastError: decision.code, nextAttemptAt: null })
      .where(mine);
    run.stats.failed++;
    if (decision.code === 'quota_exceeded') {
      // The cloud is full: every other waiting file would fail the same way. Say so once, for all of
      // them, and let "Retry" (after the operator frees space) start them again.
      run.skip.add(job.integrationId);
      await failWaiting(job.organizationId, job.target, 'quota_exceeded');
    }
  } else {
    // Revoked mid-event: nothing is lost. The file keeps waiting, the integration asks to reconnect,
    // and the row doesn't count the try.
    await db()
      .update(uploadObject)
      .set({
        status: 'pending',
        lastError: decision.code,
        nextAttemptAt: null,
        attempts: sql`greatest(${uploadObject.attempts} - 1, 0)`,
      })
      .where(mine);
    await markNeedsReauth(job.integrationId, decision.code);
    run.skip.add(job.integrationId);
    run.stats.paused++;
  }
}

/** Outputs of an organization, as a subquery for scoping upload rows to it. */
const organizationOutputs = (organizationId: string) =>
  db()
    .select({ id: output.id })
    .from(output)
    .innerJoin(captureSession, eq(captureSession.id, output.sessionId))
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(eq(event.organizationId, organizationId));

async function failWaiting(organizationId: string, provider: CloudProviderId, code: string): Promise<void> {
  await db()
    .update(uploadObject)
    .set({ status: 'failed', lastError: code, nextAttemptAt: null })
    .where(
      and(
        eq(uploadObject.target, provider),
        eq(uploadObject.status, 'pending'),
        inArray(uploadObject.outputId, organizationOutputs(organizationId)),
      ),
    );
}

async function tokenFor(job: ClaimedCopy, provider: CloudProvider, run: Run): Promise<string> {
  const cached = run.tokens.get(job.integrationId);
  if (cached && cached.expiresAt.getTime() - Date.now() > 10 * 60_000) return cached.token;
  const fresh = await provider.accessToken(openRefreshToken(job.sealedToken, job.organizationId, job.target));
  run.tokens.set(job.integrationId, fresh);
  return fresh.token;
}

/** The operator's chosen folder; created with the default name the first time if they never chose one. */
async function rootFolder(job: ClaimedCopy, provider: CloudProvider, token: string): Promise<string> {
  if (job.folderId) return job.folderId;
  return withLock(`cloud-root:${job.integrationId}`, async (tx) => {
    const [current] = await tx
      .select({ folderId: integration.folderId })
      .from(integration)
      .where(eq(integration.id, job.integrationId));
    if (current?.folderId) return current.folderId;
    const folder = await provider.ensureFolder(token, DEFAULT_CLOUD_FOLDER);
    await tx
      .update(integration)
      .set({ folderId: folder.id, folderName: folder.name, updatedAt: new Date() })
      .where(eq(integration.id, job.integrationId));
    return folder.id;
  });
}

/** `<root>/<Event name YYYY-MM-DD>`, found or created — under a lock, so concurrent uploads don't make two. */
async function eventFolderFor(
  job: ClaimedCopy,
  provider: CloudProvider,
  token: string,
  root: string,
  run: Run,
): Promise<string> {
  const key = `${job.integrationId}:${root}:${job.eventId}`;
  const known = run.folders.get(key);
  if (known) return known;
  const folder = await withLock(`cloud-folder:${key}`, async () =>
    provider.ensureFolder(token, eventFolderName(job.eventName, job.eventDate), root),
  );
  run.folders.set(key, folder.id);
  return folder.id;
}

// ---------------------------------------------------------------------------------------------
// Operator actions on the queue

/**
 * Start failed copies again (after the operator freed space, fixed the folder, …). Files that can
 * never be copied — their hosted copy expired — stay failed. Returns how many were requeued.
 */
export async function retryFailedCopies(
  organizationId: string,
  provider: CloudProviderId,
  onlyCodes?: string[],
): Promise<number> {
  const rows = await db()
    .update(uploadObject)
    .set({ status: 'pending', attempts: 0, lastError: null, nextAttemptAt: null })
    .where(
      and(
        eq(uploadObject.target, provider),
        eq(uploadObject.status, 'failed'),
        onlyCodes
          ? inArray(uploadObject.lastError, onlyCodes)
          : or(isNull(uploadObject.lastError), ne(uploadObject.lastError, 'source_gone')),
        inArray(uploadObject.outputId, organizationOutputs(organizationId)),
      ),
    )
    .returning({ id: uploadObject.id });
  return rows.length;
}

/**
 * On disconnect: forget the copies that have not happened. Done ones stay as history. If the operator
 * connects again, enqueueMissingCopies queues whatever is still unexpired and not yet copied.
 */
export async function dropOpenCopies(organizationId: string, provider: CloudProviderId): Promise<number> {
  const rows = await db()
    .delete(uploadObject)
    .where(
      and(
        eq(uploadObject.target, provider),
        ne(uploadObject.status, 'done'),
        inArray(uploadObject.outputId, organizationOutputs(organizationId)),
      ),
    )
    .returning({ id: uploadObject.id });
  return rows.length;
}
