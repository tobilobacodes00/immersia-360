import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { env } from './env';

/**
 * Test-only routes (the e2e mailbox, forcing an expiry) answer only when E2E mode is on AND the
 * request carries this run's secret. Fails closed: E2E mode without a token refuses to start (see
 * env.ts), and a deployment that somehow has E2E=1 still needs the token, which only CI knows.
 */
export function isE2ERequest(request: Request): boolean {
  const { E2E, E2E_TOKEN } = env();
  if (E2E !== '1' || !E2E_TOKEN) return false;
  const given = Buffer.from(request.headers.get('x-e2e-token') ?? '');
  const want = Buffer.from(E2E_TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
}
