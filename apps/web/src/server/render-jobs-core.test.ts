import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  HOUR_MS,
  LEASE_MS,
  MAX_ATTEMPTS,
  MAX_RENDER_MS,
  backoffMs,
  checkQuota,
  claim,
  extendLease,
  failure,
  isClaimable,
  isPermanent,
  operatorRetry,
  overTimeLimit,
  stageOf,
  type JobState,
  type QuotaLimits,
  type QuotaUsage,
} from './render-jobs-core';

const NOW = new Date('2026-10-20T12:00:00Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const job = (patch: Partial<JobState> = {}): JobState => ({
  status: 'queued',
  attempts: 0,
  nextAttemptAt: null,
  ...patch,
});

describe('who may claim a job', () => {
  it('a queued job is claimable at once, or once its backoff has passed', () => {
    expect(isClaimable(job(), NOW)).toBe(true);
    expect(isClaimable(job({ nextAttemptAt: at(-1) }), NOW)).toBe(true);
    expect(isClaimable(job({ nextAttemptAt: NOW }), NOW)).toBe(true);
    expect(isClaimable(job({ nextAttemptAt: at(1) }), NOW)).toBe(false);
  });

  it('a running job is claimable only when its lease has run out', () => {
    expect(isClaimable(job({ status: 'running', nextAttemptAt: at(1000) }), NOW)).toBe(false);
    expect(isClaimable(job({ status: 'running', nextAttemptAt: at(-1) }), NOW)).toBe(true);
    expect(isClaimable(job({ status: 'running', nextAttemptAt: null }), NOW)).toBe(false);
  });

  it('a finished job is never claimable', () => {
    expect(isClaimable(job({ status: 'done' }), NOW)).toBe(false);
    expect(isClaimable(job({ status: 'failed' }), NOW)).toBe(false);
  });
});

describe('claiming', () => {
  it('counts the try and leases the job', () => {
    expect(claim(job({ attempts: 1 }), NOW)).toEqual({
      status: 'running',
      attempts: 2,
      nextAttemptAt: at(LEASE_MS),
      error: null,
      finished: false,
    });
  });

  it('a job whose workers keep dying runs out of tries instead of being claimed forever', () => {
    const t = claim(job({ status: 'running', attempts: MAX_ATTEMPTS, nextAttemptAt: at(-1) }), NOW);
    expect(t).toMatchObject({ status: 'failed', error: 'lease_lost', finished: true, attempts: MAX_ATTEMPTS });
  });

  it('a heartbeat pushes the lease a full lease from now', () => {
    expect(extendLease(NOW)).toEqual(at(LEASE_MS));
  });

  it('stops a render that has run too long, however many heartbeats keep it alive', () => {
    expect(overTimeLimit(at(-MAX_RENDER_MS + 1000), NOW)).toBe(false);
    expect(overTimeLimit(at(-MAX_RENDER_MS - 1000), NOW)).toBe(true);
    expect(overTimeLimit(null, NOW)).toBe(false);
  });
});

describe('backoff', () => {
  it('grows by four from a minute and is capped at half an hour', () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(240_000);
    expect(backoffMs(3)).toBe(960_000);
    expect(backoffMs(4)).toBe(30 * 60_000);
    expect(backoffMs(20)).toBe(30 * 60_000);
    expect(backoffMs(0)).toBe(60_000);
  });
});

describe('after a failed try', () => {
  it('goes back in the queue after a backoff while tries remain', () => {
    expect(failure(job({ status: 'running', attempts: 1 }), 'download_failed', NOW)).toEqual({
      status: 'queued',
      attempts: 1,
      nextAttemptAt: at(60_000),
      error: 'download_failed',
      finished: false,
    });
    const second = failure(job({ status: 'running', attempts: 2 }), 'encoder_stall', NOW);
    expect(second).toMatchObject({ status: 'queued', nextAttemptAt: at(240_000) });
  });

  it('fails for good on the last try', () => {
    expect(failure(job({ status: 'running', attempts: MAX_ATTEMPTS }), 'upload_failed', NOW)).toEqual({
      status: 'failed',
      attempts: MAX_ATTEMPTS,
      nextAttemptAt: null,
      error: 'upload_failed',
      finished: true,
    });
  });

  it.each(['undecodable', 'unsupported_encoder', 'source_missing', 'invalid_recipe'] as const)(
    'fails at once for %s: another try can not fix it',
    (code) => {
      expect(isPermanent(code)).toBe(true);
      expect(failure(job({ status: 'running', attempts: 1 }), code, NOW)).toMatchObject({
        status: 'failed',
        error: code,
        finished: true,
      });
    },
  );

  it.each([
    'download_failed',
    'upload_failed',
    'timeout',
    'lease_lost',
    'shutdown',
    'gpu',
    'encoder_stall',
    'failed',
  ] as const)('retries %s', (code) => {
    expect(isPermanent(code)).toBe(false);
    expect(failure(job({ status: 'running', attempts: 1 }), code, NOW).status).toBe('queued');
  });
});

describe('the operator’s retry', () => {
  it('restarts a failed job with a fresh set of tries', () => {
    expect(operatorRetry(job({ status: 'failed', attempts: MAX_ATTEMPTS }))).toEqual({
      status: 'queued',
      attempts: 0,
      nextAttemptAt: null,
      error: null,
      finished: false,
    });
  });

  it('leaves everything else alone', () => {
    for (const status of ['queued', 'running', 'done'] as const) expect(operatorRetry(job({ status }))).toBeNull();
  });
});

describe('limits (server renders cost money)', () => {
  const limits: QuotaLimits = { eventHourly: 60, eventTotal: 500, orgDaily: 1000 };
  const usage = (patch: Partial<QuotaUsage> = {}): QuotaUsage => ({
    eventLastHour: 0,
    oldestInHour: null,
    eventTotal: 0,
    orgLastDay: 0,
    oldestInDay: null,
    ...patch,
  });

  it('allows a request under every limit', () => {
    expect(checkQuota(usage({ eventLastHour: 59, eventTotal: 499, orgLastDay: 999 }), limits, NOW)).toEqual({
      ok: true,
    });
  });

  it('refuses the event’s sixty-first job in an hour, and says when the oldest one ages out', () => {
    expect(checkQuota(usage({ eventLastHour: 60, oldestInHour: at(-(HOUR_MS - 90_000)) }), limits, NOW)).toEqual({
      ok: false,
      scope: 'event_hourly',
      retryAfterS: 90,
    });
  });

  it('refuses an organization over its day, with the time until its oldest job ages out', () => {
    const v = checkQuota(usage({ orgLastDay: 1000, oldestInDay: at(-(DAY_MS - 3_600_000)) }), limits, NOW);
    expect(v).toEqual({ ok: false, scope: 'org_daily', retryAfterS: 3600 });
  });

  it('the event’s total is a hard stop with no retry time', () => {
    expect(checkQuota(usage({ eventTotal: 500 }), limits, NOW)).toEqual({
      ok: false,
      scope: 'event_total',
      retryAfterS: 0,
    });
  });

  it('reports the hardest limit first', () => {
    const all = usage({ eventTotal: 500, orgLastDay: 1000, eventLastHour: 60 });
    expect(checkQuota(all, limits, NOW)).toMatchObject({ scope: 'event_total' });
    expect(checkQuota({ ...all, eventTotal: 0 }, limits, NOW)).toMatchObject({ scope: 'org_daily' });
    expect(checkQuota({ ...all, eventTotal: 0, orgLastDay: 0 }, limits, NOW)).toMatchObject({ scope: 'event_hourly' });
  });

  it('never asks a client to retry in under a second', () => {
    const v = checkQuota(usage({ eventLastHour: 60, oldestInHour: at(-HOUR_MS - 5000) }), limits, NOW);
    expect(v).toMatchObject({ ok: false, retryAfterS: 1 });
  });

  it('honours custom limits', () => {
    expect(checkQuota(usage({ eventLastHour: 2 }), { ...limits, eventHourly: 2 }, NOW)).toMatchObject({
      scope: 'event_hourly',
    });
  });
});

describe('stages', () => {
  it('names a running job “rendering”', () => {
    expect(stageOf('queued')).toBe('queued');
    expect(stageOf('running')).toBe('rendering');
    expect(stageOf('done')).toBe('done');
    expect(stageOf('failed')).toBe('failed');
  });
});
