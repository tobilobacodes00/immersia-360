import type { RenderJobStatus, ServerRenderError } from '@immersia/shared';

/**
 * The decisions behind the server render queue, kept free of the database so they can be tested
 * exactly (the database layer, render-jobs.ts, locks a row, asks these functions what happens to it,
 * and writes the answer). The shape is the one the cloud copy queue uses: a claim with a lease
 * (FOR UPDATE SKIP LOCKED) so many workers can share the queue, retries with exponential backoff,
 * and a limit on tries.
 */

/** Tries before a job is given up on. A server render is expensive; three honest tries are enough. */
export const MAX_ATTEMPTS = 3;
/**
 * How long a claim lasts without news. The worker extends it every minute while it renders, so this
 * only has to outlast a missed heartbeat or two: a worker that died is noticed within minutes.
 */
export const LEASE_MS = 5 * 60_000;
/** A render may not run longer than this in total, however many heartbeats keep its lease alive. */
export const MAX_RENDER_MS = 45 * 60_000;

/** 1 min, 4 min, 16 min … capped at 30 min. `attempts` counts the try that just failed. */
export const backoffMs = (attempts: number) => Math.min(60_000 * 4 ** Math.max(0, attempts - 1), 30 * 60_000);

/** Failures a retry can not fix: the take, the recipe or the worker's Chrome is the problem, not the moment. */
const PERMANENT: ReadonlySet<ServerRenderError> = new Set([
  'undecodable',
  'unsupported_encoder',
  'source_missing',
  'invalid_recipe',
]);

export const isPermanent = (code: ServerRenderError) => PERMANENT.has(code);

/** The slice of a job row the transitions read. */
export interface JobState {
  status: RenderJobStatus;
  attempts: number;
  /** Queued: earliest claim time (null = now). Running: when the lease ends. */
  nextAttemptAt: Date | null;
}

/** What to write to the row. */
export interface Transition {
  status: RenderJobStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  error: ServerRenderError | null;
  /** Finished (done or failed for good): stamp `finished_at`, drop the claim. */
  finished: boolean;
}

/** Can a worker claim this job now: queued and due, or running with a lease that ran out? */
export function isClaimable(job: JobState, now: Date): boolean {
  if (job.status === 'queued') return job.nextAttemptAt === null || job.nextAttemptAt <= now;
  if (job.status === 'running') return job.nextAttemptAt !== null && job.nextAttemptAt <= now;
  return false;
}

/**
 * A worker claims a job. A lapsed lease means the previous worker never reported back; that try
 * counted, so a job that keeps killing its workers runs out of tries instead of being claimed
 * forever. Returns the claim, or the failure that ends the job.
 */
export function claim(job: JobState, now: Date): Transition {
  if (job.attempts >= MAX_ATTEMPTS) {
    return { status: 'failed', attempts: job.attempts, nextAttemptAt: null, error: 'lease_lost', finished: true };
  }
  return {
    status: 'running',
    attempts: job.attempts + 1,
    nextAttemptAt: new Date(now.getTime() + LEASE_MS),
    error: null,
    finished: false,
  };
}

/** The lease after a heartbeat. */
export const extendLease = (now: Date) => new Date(now.getTime() + LEASE_MS);

/** Has this render run past the total time limit (measured from when the first claim started)? */
export const overTimeLimit = (startedAt: Date | null, now: Date) =>
  startedAt !== null && now.getTime() - startedAt.getTime() > MAX_RENDER_MS;

/** A try failed with `code`. Retry after a backoff, or give up. `attempts` includes the try that failed. */
export function failure(job: JobState, code: ServerRenderError, now: Date): Transition {
  if (isPermanent(code) || job.attempts >= MAX_ATTEMPTS) {
    return { status: 'failed', attempts: job.attempts, nextAttemptAt: null, error: code, finished: true };
  }
  return {
    status: 'queued',
    attempts: job.attempts,
    nextAttemptAt: new Date(now.getTime() + backoffMs(job.attempts)),
    error: code,
    finished: false,
  };
}

/** The operator pressed "Try again" on a failed job: a fresh start. Anything else is left alone. */
export function operatorRetry(job: JobState): Transition | null {
  if (job.status !== 'failed') return null;
  return { status: 'queued', attempts: 0, nextAttemptAt: null, error: null, finished: false };
}

// ---------------------------------------------------------------------------------------------
// Limits

export interface QuotaLimits {
  eventHourly: number;
  eventTotal: number;
  orgDaily: number;
}

export interface QuotaUsage {
  /** Jobs the event created in the last hour, and when the oldest of them was created. */
  eventLastHour: number;
  oldestInHour: Date | null;
  eventTotal: number;
  /** Jobs the organization created in the last 24 hours, and when the oldest of them was created. */
  orgLastDay: number;
  oldestInDay: Date | null;
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

export type QuotaVerdict =
  { ok: true } | { ok: false; scope: 'event_hourly' | 'event_total' | 'org_daily'; retryAfterS: number };

/**
 * Server renders cost money per render, so they are limited per event (per hour, and in all) and per
 * organization (per day). The event's total is the hard stop: nothing earns it back, so it carries no
 * retry time (the operator raises the limit, or asks for it to be raised). The windows report when
 * the oldest job in them ages out, which is when the next request fits.
 */
export function checkQuota(usage: QuotaUsage, limits: QuotaLimits, now: Date): QuotaVerdict {
  if (usage.eventTotal >= limits.eventTotal) return { ok: false, scope: 'event_total', retryAfterS: 0 };
  if (usage.orgLastDay >= limits.orgDaily)
    return { ok: false, scope: 'org_daily', retryAfterS: secondsUntil(usage.oldestInDay, DAY_MS, now) };
  if (usage.eventLastHour >= limits.eventHourly)
    return { ok: false, scope: 'event_hourly', retryAfterS: secondsUntil(usage.oldestInHour, HOUR_MS, now) };
  return { ok: true };
}

function secondsUntil(oldest: Date | null, windowMs: number, now: Date): number {
  if (!oldest) return 60;
  return Math.max(1, Math.ceil((oldest.getTime() + windowMs - now.getTime()) / 1000));
}

// ---------------------------------------------------------------------------------------------
// What studio shows

export type JobStage = 'queued' | 'rendering' | 'done' | 'failed';

export const stageOf = (status: RenderJobStatus): JobStage => (status === 'running' ? 'rendering' : status);
