import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@immersia/db';
import {
  CHECK_TIMEOUT_MS,
  gradeCheck,
  overallState,
  type Overall,
  type ServiceCheck,
  type ServiceId,
} from '@/lib/status/services';
import { emailTransportReachable } from './email';
import { env } from './env';
import { storageConfigured, storageReachable } from './storage';

/**
 * The status page's checks (HLP-4): the things Immersia 360 itself depends on, asked directly and
 * graded by time and outcome. No third-party status service. Each check has its own timeout, the
 * answer is kept for a short while so a busy page doesn't hammer the database or the bucket, and a
 * check that fails never reveals why (the log has it).
 */

export interface StatusReport {
  overall: Overall;
  /** ISO time the checks ran. */
  checkedAt: string;
  services: ServiceCheck[];
}

/** How long a result is reused. */
export const STATUS_CACHE_S = 20;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Run a probe: true = healthy, null = this deployment doesn't use the service. */
async function check(id: ServiceId, probe: () => Promise<boolean | null>): Promise<ServiceCheck> {
  const started = performance.now();
  try {
    const ok = await withTimeout(probe(), CHECK_TIMEOUT_MS);
    if (ok === null) return { id, state: 'not_configured', ms: null };
    const ms = Math.round(performance.now() - started);
    return { id, state: gradeCheck({ ok, ms }), ms };
  } catch (err) {
    console.error(`[status] ${id} check failed`, err instanceof Error ? err.message : err);
    return { id, state: 'down', ms: Math.round(performance.now() - started) };
  }
}

async function runChecks(): Promise<StatusReport> {
  const services = await Promise.all([
    check('database', async () => {
      await db().execute(sql`select 1`);
      return true;
    }),
    check('storage', async () => (storageConfigured() ? await storageReachable() : null)),
    check('realtime', async () => {
      const hub = env().REALTIME_URL?.replace(/\/$/, '');
      if (!hub) return null;
      const res = await fetch(`${hub}/health`, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), cache: 'no-store' });
      return res.ok;
    }),
    check('email', emailTransportReachable),
  ]);
  return { overall: overallState(services), checkedAt: new Date().toISOString(), services };
}

let cached: { at: number; report: Promise<StatusReport> } | undefined;

/** The current report; concurrent callers share one run, and a run is reused for STATUS_CACHE_S seconds. */
export function getStatus(now = Date.now()): Promise<StatusReport> {
  if (cached && now - cached.at < STATUS_CACHE_S * 1000) return cached.report;
  const report = runChecks();
  cached = { at: now, report };
  // A run that threw (not a failed check, which is a result) isn't kept.
  report.catch(() => {
    if (cached?.report === report) cached = undefined;
  });
  return report;
}
