/**
 * What the status page reports (HLP-4): the services Immersia 360 itself runs on, each one checked
 * by the server and graded here. Pure, so the grading is tested exactly.
 */
export const SERVICE_IDS = ['database', 'storage', 'realtime', 'email'] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

/** `not_configured`: this deployment doesn't use the service (no Live Display hub, no email sender in development). */
export type ServiceState = 'operational' | 'degraded' | 'down' | 'not_configured';

export interface ServiceCheck {
  id: ServiceId;
  state: ServiceState;
  /** How long the check took; null when it wasn't run. */
  ms: number | null;
}

export type Overall = 'operational' | 'degraded' | 'outage';

/** A check that answers, but slower than this, is "degraded". */
export const DEGRADED_MS = 2000;
/** A check that hasn't answered by now is "down". */
export const CHECK_TIMEOUT_MS = 4000;

/**
 * Without these three nothing works for guests or operators: no accounts, no downloads, no sign-in
 * emails. The Live Display hub is optional (screens fall back to polling).
 */
export const CORE_SERVICES: readonly ServiceId[] = ['database', 'storage', 'email'];

export function gradeCheck(result: { ok: boolean; ms: number }): ServiceState {
  if (!result.ok) return 'down';
  return result.ms > DEGRADED_MS ? 'degraded' : 'operational';
}

export function overallState(services: readonly ServiceCheck[]): Overall {
  const active = services.filter((s) => s.state !== 'not_configured');
  if (active.some((s) => s.state === 'down' && CORE_SERVICES.includes(s.id))) return 'outage';
  if (active.some((s) => s.state === 'down' || s.state === 'degraded')) return 'degraded';
  return 'operational';
}
