import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { after } from 'next/server';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import {
  SERVER_FILE_ROLES,
  isServerRenderError,
  recipeAssetIds,
  renderRecipeSchema,
  uuidv7,
  workerOutputMime,
  type RenderRecipe,
  type ServerFileRole,
  type ServerFilesRequest,
  type ServerFilesResult,
  type ServerRenderError,
  type ServerRenderJobView,
  type ServerRenderRefusal,
  type ServerRenderRequest,
  type WorkerClaim,
  type WorkerOutputKind,
  type WorkerOutputTicket,
  type WorkerOutputsRequest,
} from '@immersia/shared';
import type { DeviceRow } from './devices';
import { env } from './env';
import {
  checkQuota,
  claim as claimTransition,
  extendLease,
  failure as failureTransition,
  operatorRetry,
  overTimeLimit,
  stageOf,
  DAY_MS,
  HOUR_MS,
  LEASE_MS,
  MAX_ATTEMPTS,
  type JobStage,
  type Transition,
} from './render-jobs-core';
import { wakeRenderWorker } from './render-worker-wake';
import { uploadGate } from './erasure-core';
import { markOutputUploaded } from './sessions';
import { deleteObjects, objectKey, objectSize, presignUpload, presignView, takeFileKey } from './storage';

const { serverRenderJob: job, take, captureSession, event, output, asset } = schema;

type JobRow = typeof job.$inferSelect;

/** The `server` rung exists only where a render worker is configured. */
export const serverRenderEnabled = (): boolean => Boolean(env().RENDER_WORKER_SECRET);

/** Download links for a job's files outlast the longest render plus its retries' waiting. */
const URL_TTL_S = 3 * 3600;

/** A take's working files are kept this long when nothing is rendering them. */
const WORKING_FILES_KEEP_MS = 7 * 24 * HOUR_MS;

const EXT: Record<WorkerOutputKind, string> = { mp4: 'mp4', small_mp4: 'mp4', poster: 'jpg' };

const viewOf = (row: Pick<JobRow, 'id' | 'status' | 'attempts' | 'error' | 'renderMs'>): ServerRenderJobView => ({
  id: row.id,
  status: row.status,
  attempts: row.attempts,
  renderMs: row.renderMs,
  error: row.error === null ? null : isServerRenderError(row.error) ? row.error : 'failed',
});

/** The columns that say whether a session still takes files (see uploadGate in erasure-core.ts). */
const sessionGateColumns = {
  id: captureSession.id,
  erasedAt: captureSession.erasedAt,
  expiredAt: captureSession.expiredAt,
  removedAt: captureSession.removedAt,
  removal: captureSession.removal,
};

/**
 * Whether a server render may still produce files for this session. The same rule a booth's own uploads
 * follow: not erased by the guest, not taken down by the platform (an operator's hide is reversible and
 * touches no files, so it does not stop a render), and not expired.
 */
const sessionAcceptsFiles = (session: {
  erasedAt: Date | null;
  expiredAt: Date | null;
  removedAt: Date | null;
  removal: typeof captureSession.$inferSelect.removal;
}) => session.expiredAt === null && uploadGate(session) === 'ok';

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e && typeof e === 'object'; i++) {
    if ((e as { code?: unknown }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Booth → server

/** A take of this device's organization, with what its files' keys are made from. */
async function ownedTake(organizationId: string, takeId: string) {
  const [row] = await db()
    .select({ id: take.id, eventId: take.eventId, organizationId: event.organizationId, deviceId: take.deviceId })
    .from(take)
    .innerJoin(event, eq(event.id, take.eventId))
    .where(and(eq(take.id, takeId), eq(event.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/**
 * Upload URLs for the files a server render needs (the take's original, the overlay and the end card
 * the booth drew). The exact size and type are signed. A file already stored at the declared size
 * needs no upload, so a booth that lost its connection mid-way continues where it stopped.
 */
export async function requestFiles(
  device: DeviceRow,
  takeId: string,
  request: ServerFilesRequest,
): Promise<ServerFilesResult | { error: 'take_not_registered' | 'server_render_unavailable' }> {
  if (!serverRenderEnabled()) return { error: 'server_render_unavailable' };
  const t = await ownedTake(device.organizationId, takeId);
  if (!t) return { error: 'take_not_registered' };
  const uploads: ServerFilesResult['uploads'] = [];
  const stored: ServerFileRole[] = [];
  for (const f of request.files) {
    const key = takeFileKey(t.organizationId, t.eventId, t.id, f.role);
    // From here on files may exist for this take: remember where, so the sweep can remove them.
    if (f.role === 'original') await db().update(take).set({ rawObjectKey: key }).where(eq(take.id, takeId));
    if ((await objectSize(key)) === f.bytes) stored.push(f.role);
    else uploads.push({ role: f.role, ...(await presignUpload(key, f.mime, f.bytes)) });
  }
  return { uploads, stored };
}

async function latestJob(takeId: string): Promise<JobRow | null> {
  const [row] = await db().select().from(job).where(eq(job.takeId, takeId)).orderBy(desc(job.createdAt)).limit(1);
  return row ?? null;
}

/** The latest server render of a take, for the booth that asked for it. */
export async function jobForTake(device: DeviceRow, takeId: string): Promise<ServerRenderJobView | null> {
  const t = await ownedTake(device.organizationId, takeId);
  if (!t) return null;
  const row = await latestJob(takeId);
  return row ? viewOf(row) : null;
}

/**
 * Queue a server render of a take whose files the booth has uploaded. Idempotent: a take with a job
 * in flight (or done) answers with that job, so a booth that retries after a lost response neither
 * pays twice nor queues twice. Refuses, with a reason the booth can show, when the server render is
 * off, the files are not all in storage, an asset is not the organization's, or a limit is reached.
 */
export async function requestRender(
  device: DeviceRow,
  takeId: string,
  input: ServerRenderRequest,
): Promise<{ job: ServerRenderJobView } | ServerRenderRefusal> {
  if (!serverRenderEnabled()) return { error: 'server_render_unavailable' };
  const t = await ownedTake(device.organizationId, takeId);
  if (!t) return { error: 'take_not_registered' };

  const existing = await latestJob(takeId);
  if (existing && existing.status !== 'failed') return { job: viewOf(existing) };

  const [session] = await db()
    .select(sessionGateColumns)
    .from(captureSession)
    .where(and(eq(captureSession.id, input.sessionId), eq(captureSession.eventId, t.eventId)))
    .limit(1);
  if (!session) return { error: 'session_not_found' };
  // An erased, taken-down or expired session has no guest to render for: final, not worth retrying.
  if (!sessionAcceptsFiles(session)) return { error: 'session_gone' };

  // The recipe says what was uploaded; storage says whether it really was.
  const { recipe } = input;
  const wanted: [ServerFileRole, number][] = [['original', recipe.files.original.bytes]];
  if (recipe.files.overlay) wanted.push(['overlay', recipe.files.overlay.bytes]);
  if (recipe.files.endCard) wanted.push(['end_card', recipe.files.endCard.bytes]);
  const sizes = await Promise.all(
    wanted.map(([role]) => objectSize(takeFileKey(t.organizationId, t.eventId, t.id, role))),
  );
  if (wanted.some(([, bytes], i) => sizes[i] !== bytes)) return { error: 'files_incomplete' };

  if (!(await assetsAreUsable(t.organizationId, recipe))) return { error: 'asset_invalid' };

  const quota = await checkQuota(await quotaUsage(t.eventId, t.organizationId), quotaLimits(), new Date());
  if (!quota.ok) return { error: 'render_rate_limited', scope: quota.scope, retryAfterS: quota.retryAfterS };

  const id = uuidv7();
  try {
    await db().transaction(async (tx) => {
      await tx.insert(job).values({
        id,
        eventId: t.eventId,
        sessionId: input.sessionId,
        takeId,
        deviceId: device.id,
        recipe,
      });
      await tx
        .update(take)
        .set({ rawObjectKey: takeFileKey(t.organizationId, t.eventId, t.id, 'original'), status: 'uploaded' })
        .where(eq(take.id, takeId));
    });
  } catch (err) {
    // Two requests for the same take raced: the other one won, and its job is the answer.
    if (isUniqueViolation(err)) {
      const winner = await latestJob(takeId);
      if (winner) return { job: viewOf(winner) };
    }
    throw err;
  }
  after(() => void wakeRenderWorker());
  return { job: { id, status: 'queued', attempts: 0, error: null, renderMs: null } };
}

/**
 * The recipe's library assets must be the organization's own, ready to use, and of the kind the
 * recipe uses them as (music, intro, outro): a client can not point a job at another tenant's files.
 */
async function assetsAreUsable(organizationId: string, recipe: RenderRecipe): Promise<boolean> {
  const ids = recipeAssetIds(recipe);
  if (!ids.length) return true;
  const rows = await db()
    .select({ id: asset.id, type: asset.type, mime: asset.mime })
    .from(asset)
    .where(
      and(
        inArray(asset.id, ids),
        eq(asset.organizationId, organizationId),
        eq(asset.status, 'ready'),
        isNull(asset.deletedAt),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const card = (c: RenderRecipe['intro'], type: 'intro' | 'outro') => {
    if (!c) return true;
    const a = byId.get(c.assetId);
    return Boolean(a && a.type === type && a.mime.startsWith(c.kind === 'image' ? 'image/' : 'video/'));
  };
  const music = recipe.music ? byId.get(recipe.music.assetId) : null;
  const bg = recipe.background;
  const backgroundOk =
    !bg ||
    !('assetId' in bg) ||
    (() => {
      const a = byId.get(bg.assetId);
      return Boolean(a && a.type === 'background' && a.mime.startsWith(bg.kind === 'image' ? 'image/' : 'video/'));
    })();
  return (
    (!recipe.music || music?.type === 'audio') &&
    card(recipe.intro, 'intro') &&
    card(recipe.outro, 'outro') &&
    backgroundOk
  );
}

export function quotaLimits() {
  const e = env();
  return {
    eventHourly: e.SERVER_RENDER_LIMIT_EVENT_HOURLY,
    eventTotal: e.SERVER_RENDER_LIMIT_EVENT_TOTAL,
    orgDaily: e.SERVER_RENDER_LIMIT_ORG_DAILY,
  };
}

/** Jobs created: by this event (in the last hour, and in all) and by its organization (in the last day). */
async function quotaUsage(eventId: string, organizationId: string) {
  const now = Date.now();
  const hourAgo = new Date(now - HOUR_MS);
  const dayAgo = new Date(now - DAY_MS);
  const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string | Date));
  const [ev] = await db()
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      lastHour: sql<number>`count(*) filter (where ${job.createdAt} > ${hourAgo})`.mapWith(Number),
      oldestInHour: sql<Date | null>`min(${job.createdAt}) filter (where ${job.createdAt} > ${hourAgo})`.mapWith(date),
    })
    .from(job)
    .where(eq(job.eventId, eventId));
  const [org] = await db()
    .select({
      lastDay: sql<number>`count(*)`.mapWith(Number),
      oldestInDay: sql<Date | null>`min(${job.createdAt})`.mapWith(date),
    })
    .from(job)
    .innerJoin(event, eq(event.id, job.eventId))
    .where(and(eq(event.organizationId, organizationId), sql`${job.createdAt} > ${dayAgo}`));
  return {
    eventTotal: ev?.total ?? 0,
    eventLastHour: ev?.lastHour ?? 0,
    oldestInHour: ev?.oldestInHour ?? null,
    orgLastDay: org?.lastDay ?? 0,
    oldestInDay: org?.oldestInDay ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Worker → server

/** Is this request from the render worker? A shared secret, compared in constant time. */
export function isRenderWorker(request: Request): boolean {
  const secret = env().RENDER_WORKER_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Hash both sides so the comparison is over equal lengths and leaks nothing about the secret's.
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

/** The values a finished transition writes. */
const write = (t: Transition, now: Date) => ({
  status: t.status,
  attempts: t.attempts,
  nextAttemptAt: t.nextAttemptAt,
  error: t.error,
  // A claim ends when the job leaves `running`; a finished job also stops being anyone's.
  ...(t.status !== 'running' ? { claimToken: null, workerId: null } : {}),
  ...(t.finished ? { finishedAt: now } : {}),
});

/**
 * Hand the oldest due job to a worker: queued and past its backoff, or running with a lease that ran
 * out (its worker never reported back). FOR UPDATE SKIP LOCKED lets any number of workers share the
 * queue, and the lease keeps the claim after this transaction ends.
 */
interface Claimed {
  row: JobRow;
  claimToken: string | null;
  /** Set when the job ended instead of being handed out (its tries ran out while it was leased). */
  ended: ServerRenderError | null;
}

export async function claimJob(workerId: string): Promise<WorkerClaim> {
  for (let skipped = 0; skipped < 10; skipped++) {
    const now = new Date();
    const claimed = await db().transaction(async (tx): Promise<Claimed | null> => {
      const [row] = await tx
        .select()
        .from(job)
        .where(
          or(
            and(eq(job.status, 'queued'), or(isNull(job.nextAttemptAt), lte(job.nextAttemptAt, now))),
            and(eq(job.status, 'running'), lte(job.nextAttemptAt, now)),
          ),
        )
        .orderBy(asc(job.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return null;
      // The guest erased the session, the platform took it down, or it expired, while the job waited.
      const [state] = await tx
        .select(sessionGateColumns)
        .from(captureSession)
        .where(eq(captureSession.id, row.sessionId))
        .limit(1);
      if (!state || !sessionAcceptsFiles(state)) {
        const gone = failureTransition(row, 'source_missing', now);
        await tx.update(job).set(write(gone, now)).where(eq(job.id, row.id));
        return { row, claimToken: null, ended: 'source_missing' };
      }
      const next = claimTransition(row, now);
      if (next.finished) {
        await tx.update(job).set(write(next, now)).where(eq(job.id, row.id));
        return { row, claimToken: null, ended: next.error };
      }
      const claimToken = randomBytes(24).toString('base64url');
      await tx
        .update(job)
        .set({ ...write(next, now), claimToken, workerId, startedAt: now })
        .where(eq(job.id, row.id));
      return { row: { ...row, attempts: next.attempts }, claimToken, ended: null };
    });
    if (!claimed) return { job: null };
    if (claimed.ended) continue;
    const recipe = renderRecipeSchema.safeParse(claimed.row.recipe);
    if (!recipe.success) {
      // A booth and a worker that disagree on the recipe: not fixable by trying again.
      await settleFailure(claimed.row.id, claimed.claimToken!, 'invalid_recipe');
      continue;
    }
    return {
      job: {
        id: claimed.row.id,
        claimToken: claimed.claimToken!,
        attempts: claimed.row.attempts,
        maxAttempts: MAX_ATTEMPTS,
        leaseMs: LEASE_MS,
        recipe: recipe.data,
        urls: await downloadUrls(claimed.row, recipe.data),
      },
    };
  }
  return { job: null };
}

/** Short-lived download links for everything a job reads. A library asset that is gone is left out (the render goes without it). */
async function downloadUrls(row: JobRow, recipe: RenderRecipe): Promise<NonNullable<WorkerClaim['job']>['urls']> {
  const [ev] = await db()
    .select({ organizationId: event.organizationId })
    .from(event)
    .where(eq(event.id, row.eventId))
    .limit(1);
  const org = ev!.organizationId;
  const file = (role: ServerFileRole) => presignView(takeFileKey(org, row.eventId, row.takeId, role), URL_TTL_S);
  const ids = recipeAssetIds(recipe);
  const assets = ids.length
    ? await db()
        .select({ id: asset.id, key: asset.objectKey })
        .from(asset)
        .where(and(inArray(asset.id, ids), eq(asset.organizationId, org), isNull(asset.deletedAt)))
    : [];
  const keyOf = new Map(assets.map((a) => [a.id, a.key]));
  const assetUrl = async (id: string | undefined) => {
    const key = id ? keyOf.get(id) : undefined;
    return key ? presignView(key, URL_TTL_S) : null;
  };
  const bgId = recipe.background && 'assetId' in recipe.background ? recipe.background.assetId : undefined;
  const [original, overlay, endCard, intro, outro, music, background] = await Promise.all([
    file('original'),
    recipe.files.overlay ? file('overlay') : null,
    recipe.files.endCard ? file('end_card') : null,
    assetUrl(recipe.intro?.assetId),
    assetUrl(recipe.outro?.assetId),
    assetUrl(recipe.music?.assetId),
    assetUrl(bgId),
  ]);
  return { original, overlay, endCard, intro, outro, music, background };
}

/** The running job this token holds, or null (it finished, was reclaimed, or the token is wrong). */
async function heldJob(jobId: string, claimToken: string): Promise<JobRow | null> {
  const [row] = await db()
    .select({ job, session: sessionGateColumns })
    .from(job)
    .innerJoin(captureSession, eq(captureSession.id, job.sessionId))
    .where(and(eq(job.id, jobId), eq(job.status, 'running'), eq(job.claimToken, claimToken)))
    .limit(1);
  // A guest who erased their session (or a platform takedown) must not get files back through a render
  // already under way: the worker is told the job is no longer its own.
  return row && sessionAcceptsFiles(row.session) ? row.job : null;
}

/** Extend the lease while a render goes on. `timeout`: it ran past the time limit and was stopped. */
export async function heartbeat(jobId: string, claimToken: string): Promise<'ok' | 'lease_lost' | 'timeout'> {
  const row = await heldJob(jobId, claimToken);
  if (!row) return 'lease_lost';
  const now = new Date();
  if (overTimeLimit(row.startedAt, now)) {
    await settleFailure(jobId, claimToken, 'timeout');
    return 'timeout';
  }
  await db()
    .update(job)
    .set({ nextAttemptAt: extendLease(now) })
    .where(and(eq(job.id, jobId), eq(job.claimToken, claimToken)));
  return 'ok';
}

/**
 * The worker has rendered and is about to upload: make (or find) the session's output rows and hand
 * out upload URLs. Rows are keyed by (session, kind, take), so a retried job reuses its rows; the
 * file is overwritten in place and counts as not uploaded again until the worker completes the job.
 */
export async function registerOutputs(
  jobId: string,
  request: WorkerOutputsRequest,
): Promise<{ uploads: WorkerOutputTicket[] } | { error: 'lease_lost' }> {
  const row = await heldJob(jobId, request.claimToken);
  if (!row) return { error: 'lease_lost' };
  const [ev] = await db()
    .select({ organizationId: event.organizationId })
    .from(event)
    .where(eq(event.id, row.eventId))
    .limit(1);
  const uploads: WorkerOutputTicket[] = [];
  for (const o of request.outputs) {
    const mime = workerOutputMime(o.kind);
    const id = uuidv7();
    const [saved] = await db()
      .insert(output)
      .values({
        id,
        sessionId: row.sessionId,
        takeId: row.takeId,
        kind: o.kind,
        mime,
        bytes: o.bytes,
        width: o.width,
        height: o.height,
        durationMs: o.durationMs,
        objectKey: objectKey(ev!.organizationId, row.eventId, id, EXT[o.kind]),
      })
      .onConflictDoUpdate({
        target: [output.sessionId, output.kind, output.takeId],
        set: { mime, bytes: o.bytes, width: o.width, height: o.height, durationMs: o.durationMs, uploadedAt: null },
      })
      .returning({ id: output.id, key: output.objectKey });
    uploads.push({ kind: o.kind, outputId: saved!.id, ...(await presignUpload(saved!.key!, mime, o.bytes)) });
  }
  return { uploads };
}

/**
 * The worker has uploaded everything: check the files really are in storage at their declared size,
 * publish them like a booth's uploads, and finish the job.
 */
export async function completeJob(
  jobId: string,
  claimToken: string,
  renderMs: number,
): Promise<'ok' | 'lease_lost' | 'incomplete'> {
  const row = await heldJob(jobId, claimToken);
  if (!row) return 'lease_lost';
  const pending = await db()
    .select({ id: output.id, kind: output.kind, key: output.objectKey, mime: output.mime, bytes: output.bytes })
    .from(output)
    .where(
      and(
        eq(output.sessionId, row.sessionId),
        eq(output.takeId, row.takeId),
        inArray(output.kind, ['mp4', 'small_mp4', 'poster']),
        isNull(output.uploadedAt),
      ),
    );
  if (!pending.some((p) => p.kind === 'mp4')) return 'incomplete';
  for (const p of pending) {
    if (!p.key || (await objectSize(p.key)) !== p.bytes) return 'incomplete';
  }
  // The poster first: the share page shows it before the video loads.
  const order: Record<string, number> = { poster: 0, small_mp4: 1, mp4: 2 };
  const organizationId = await organizationOf(row);
  for (const p of [...pending].sort((a, b) => order[a.kind]! - order[b.kind]!))
    await markOutputUploaded({
      outputId: p.id,
      sessionId: row.sessionId,
      eventId: row.eventId,
      organizationId,
      objectKey: p.key!,
      mime: p.mime,
      bytes: p.bytes!,
    });
  const now = new Date();
  const done = await db()
    .update(job)
    .set({
      status: 'done',
      error: null,
      finishedAt: now,
      renderMs,
      nextAttemptAt: null,
      claimToken: null,
      workerId: null,
    })
    .where(and(eq(job.id, jobId), eq(job.claimToken, claimToken)))
    .returning({ id: job.id });
  if (!done.length) return 'lease_lost';
  // The working copies have done their job; the guest's files are the outputs.
  after(() => deleteWorkingFiles([row.takeId]));
  return 'ok';
}

/** A try failed. Decide: back in the queue after a backoff, or failed for good. */
export async function failJob(jobId: string, claimToken: string, code: ServerRenderError): Promise<boolean> {
  return settleFailure(jobId, claimToken, code);
}

async function settleFailure(jobId: string, claimToken: string, code: ServerRenderError): Promise<boolean> {
  const row = await heldJob(jobId, claimToken);
  if (!row) return false;
  const now = new Date();
  const next = failureTransition(row, code, now);
  const rows = await db()
    .update(job)
    .set(write(next, now))
    .where(and(eq(job.id, jobId), eq(job.claimToken, claimToken)))
    .returning({ id: job.id });
  return rows.length > 0;
}

async function organizationOf(row: JobRow): Promise<string> {
  const [ev] = await db()
    .select({ organizationId: event.organizationId })
    .from(event)
    .where(eq(event.id, row.eventId))
    .limit(1);
  return ev!.organizationId;
}

// ---------------------------------------------------------------------------------------------
// Working files

/** Delete the working copies (original, overlay, end card) of these takes, and forget the original. */
export async function deleteWorkingFiles(takeIds: string[]): Promise<number> {
  if (!takeIds.length) return 0;
  try {
    const rows = await db()
      .select({ id: take.id, eventId: take.eventId, organizationId: event.organizationId })
      .from(take)
      .innerJoin(event, eq(event.id, take.eventId))
      .where(inArray(take.id, takeIds));
    const keys = rows.flatMap((r) =>
      SERVER_FILE_ROLES.map((role) => takeFileKey(r.organizationId, r.eventId, r.id, role)),
    );
    const removed = keys.length ? await deleteObjects(keys) : 0;
    await db().update(take).set({ rawObjectKey: null }).where(inArray(take.id, takeIds));
    return removed;
  } catch (err) {
    // Best effort: the cron sweep removes whatever is left.
    console.error('[render-jobs] could not delete working files', err instanceof Error ? err.name : err);
    return 0;
  }
}

/**
 * A session was erased: its open server renders stop (no worker may publish files for it any more)
 * and the working copies of its takes are deleted. Idempotent; best effort on the files, which the
 * erasure sweep removes again.
 */
export async function abandonServerRenders(sessionId: string): Promise<void> {
  await db()
    .update(job)
    .set({
      status: 'failed',
      error: 'source_missing',
      finishedAt: new Date(),
      nextAttemptAt: null,
      claimToken: null,
      workerId: null,
    })
    .where(and(eq(job.sessionId, sessionId), inArray(job.status, ['queued', 'running'])));
  const takes = await db().selectDistinct({ id: job.takeId }).from(job).where(eq(job.sessionId, sessionId));
  await deleteWorkingFiles(takes.map((t) => t.id));
}

/** Object keys of the working files of the jobs of a session (for the expiry sweep). */
export async function workingFileKeysForSession(sessionId: string): Promise<string[]> {
  const rows = await db()
    .selectDistinct({ takeId: job.takeId, eventId: job.eventId, organizationId: event.organizationId })
    .from(job)
    .innerJoin(event, eq(event.id, job.eventId))
    .where(eq(job.sessionId, sessionId));
  return rows.flatMap((r) => SERVER_FILE_ROLES.map((role) => takeFileKey(r.organizationId, r.eventId, r.takeId, role)));
}

export interface RenderSweepStats {
  /** Takes whose abandoned working files were removed. */
  purged: number;
  /** A worker was woken for work that was waiting. */
  woke: boolean;
}

/**
 * The cron sweep: remove working files nothing is going to use (an upload whose job was never asked
 * for, or a failed job nobody retried in a week), and wake the worker if work is waiting (a job whose
 * wake-up failed, or whose lease ran out while no worker was up to notice).
 */
export async function sweepServerRenders(): Promise<RenderSweepStats> {
  if (!serverRenderEnabled()) return { purged: 0, woke: false };
  const cutoff = new Date(Date.now() - WORKING_FILES_KEEP_MS);
  const stale = await db()
    .select({ id: take.id })
    .from(take)
    .where(
      and(
        isNotNull(take.rawObjectKey),
        lt(take.receivedAt, cutoff),
        sql`not exists (select 1 from ${job} where ${job.takeId} = ${take.id} and ${job.status} in ('queued', 'running'))`,
      ),
    )
    .limit(200);
  await deleteWorkingFiles(stale.map((t) => t.id));
  const now = new Date();
  const [waiting] = await db()
    .select({ id: job.id })
    .from(job)
    .where(
      or(
        and(eq(job.status, 'queued'), or(isNull(job.nextAttemptAt), lte(job.nextAttemptAt, now))),
        and(eq(job.status, 'running'), lte(job.nextAttemptAt, now)),
      ),
    )
    .limit(1);
  if (waiting) await wakeRenderWorker();
  return { purged: stale.length, woke: Boolean(waiting) };
}

// ---------------------------------------------------------------------------------------------
// Studio

export interface ServerRenderRow {
  id: string;
  stage: JobStage;
  attempts: number;
  error: ServerRenderError | null;
  /** The guest's short code, to recognise the take. */
  shortCode: string;
  createdAt: Date;
  finishedAt: Date | null;
  renderMs: number | null;
  /** A failed job whose files are still in storage can be started again. */
  canRetry: boolean;
}

/** The event's server renders, newest first (organization-scoped). */
export async function listServerRenders(
  organizationId: string,
  eventId: string,
  limit = 50,
): Promise<ServerRenderRow[]> {
  const rows = await db()
    .select({
      id: job.id,
      status: job.status,
      attempts: job.attempts,
      error: job.error,
      shortCode: captureSession.shortCode,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      renderMs: job.renderMs,
      rawObjectKey: take.rawObjectKey,
      expiredAt: captureSession.expiredAt,
    })
    .from(job)
    .innerJoin(event, eq(event.id, job.eventId))
    .innerJoin(captureSession, eq(captureSession.id, job.sessionId))
    .innerJoin(take, eq(take.id, job.takeId))
    .where(and(eq(job.eventId, eventId), eq(event.organizationId, organizationId)))
    .orderBy(desc(job.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    stage: stageOf(r.status),
    attempts: r.attempts,
    error: r.error === null ? null : isServerRenderError(r.error) ? r.error : 'failed',
    shortCode: r.shortCode,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    renderMs: r.renderMs,
    canRetry: r.status === 'failed' && r.rawObjectKey !== null && r.expiredAt === null,
  }));
}

/** Counts by stage, for the dashboard's headline. */
export async function serverRenderCounts(organizationId: string, eventId: string) {
  const rows = await db()
    .select({ status: job.status, n: sql<number>`count(*)`.mapWith(Number) })
    .from(job)
    .innerJoin(event, eq(event.id, job.eventId))
    .where(and(eq(job.eventId, eventId), eq(event.organizationId, organizationId)))
    .groupBy(job.status);
  const by = new Map(rows.map((r) => [r.status, r.n]));
  return {
    queued: by.get('queued') ?? 0,
    rendering: by.get('running') ?? 0,
    done: by.get('done') ?? 0,
    failed: by.get('failed') ?? 0,
  };
}

/** The operator starts a failed server render again, with a fresh set of tries. */
export async function retryServerRender(
  organizationId: string,
  jobId: string,
): Promise<'ok' | 'not_found' | 'not_failed' | 'files_gone' | 'conflict'> {
  try {
    const result = await db().transaction(async (tx) => {
      const [row] = await tx
        .select({
          job,
          rawObjectKey: take.rawObjectKey,
          expiredAt: captureSession.expiredAt,
        })
        .from(job)
        .innerJoin(event, eq(event.id, job.eventId))
        .innerJoin(take, eq(take.id, job.takeId))
        .innerJoin(captureSession, eq(captureSession.id, job.sessionId))
        .where(and(eq(job.id, jobId), eq(event.organizationId, organizationId)))
        .limit(1)
        .for('update', { of: job });
      if (!row) return 'not_found' as const;
      const next = operatorRetry(row.job);
      if (!next) return 'not_failed' as const;
      if (!row.rawObjectKey || row.expiredAt) return 'files_gone' as const;
      await tx
        .update(job)
        .set({ ...write(next, new Date()), finishedAt: null, startedAt: null, renderMs: null })
        .where(eq(job.id, jobId));
      return 'ok' as const;
    });
    if (result === 'ok') after(() => void wakeRenderWorker());
    return result;
  } catch (err) {
    // Another job for the same take was queued meanwhile (the booth asked again).
    if (isUniqueViolation(err)) return 'conflict';
    throw err;
  }
}
