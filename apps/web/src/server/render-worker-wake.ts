import 'server-only';
import { env } from './env';
import { decideWake, type FlyMachine } from './render-worker-wake-core';

export type WakeResult = 'disabled' | 'running' | 'started' | 'no_machine' | 'error';

const DEFAULT_API = 'https://api.machines.dev';

/**
 * The render worker runs on Fly.io Machines and scales to zero: it exits after a few idle minutes
 * and the machine stops. When a job is queued this starts it again (the Machines API; the worker
 * then polls the queue by itself). With FLY_API_TOKEN or FLY_APP unset it does nothing, which is the
 * right thing when the worker runs somewhere else (a long-lived container, a developer's machine).
 *
 * Idempotent and cheap: it lists the app's machines and starts one only when none is running or on
 * its way up. Safe to call on every queued job and from the cron sweep. Never throws: a failure to
 * wake the worker must not fail the request that queued the job (the cron sweep tries again).
 */
export async function wakeRenderWorker(): Promise<WakeResult> {
  const { FLY_API_TOKEN: token, FLY_APP: app, FLY_API_URL: base } = env();
  if (!token || !app) return 'disabled';
  const root = `${(base ?? DEFAULT_API).replace(/\/$/, '')}/v1/apps/${encodeURIComponent(app)}/machines`;
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${root}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
  try {
    const list = await call('');
    if (!list.ok) throw new Error(`list machines: ${list.status}`);
    const decision = decideWake((await list.json()) as FlyMachine[]);
    if (decision.action === 'none') return decision.reason === 'no_machine' ? 'no_machine' : 'running';
    const start = await call(`/${encodeURIComponent(decision.id)}/start`, { method: 'POST' });
    // 200 started; a machine that raced us into "started" answers with an error we can ignore.
    if (!start.ok && start.status !== 409 && start.status !== 412) throw new Error(`start machine: ${start.status}`);
    return 'started';
  } catch (err) {
    // The error text never includes the token (it is only in the header).
    console.error('[render-worker] could not wake the worker', err instanceof Error ? err.message : err);
    return 'error';
  }
}
