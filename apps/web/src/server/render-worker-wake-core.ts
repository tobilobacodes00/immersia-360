/** A machine as the Fly Machines API lists it (the fields we read). */
export interface FlyMachine {
  id: string;
  state: string;
}

/** States in which a machine is up, or on its way up: the worker there will poll the queue. */
const UP = new Set(['created', 'starting', 'started', 'replacing']);
/** States a machine can be started from. */
const STARTABLE = new Set(['stopped', 'suspended']);

export type WakeDecision = { action: 'none'; reason: 'running' | 'no_machine' } | { action: 'start'; id: string };

/**
 * Whether to start a machine. One running (or starting) machine is enough: it serves the whole queue.
 * Otherwise start one stopped machine. A machine that is stopping is left alone: the worker checks the
 * queue once more before it exits, and the next call (the next job, or the cron sweep) finds it stopped.
 */
export function decideWake(machines: readonly FlyMachine[]): WakeDecision {
  if (machines.some((m) => UP.has(m.state))) return { action: 'none', reason: 'running' };
  const startable = machines.find((m) => STARTABLE.has(m.state));
  if (startable) return { action: 'start', id: startable.id };
  // Machines that are going away do not count; anything else (stopping…) will be startable shortly.
  const remaining = machines.filter((m) => m.state !== 'destroyed' && m.state !== 'destroying');
  return { action: 'none', reason: remaining.length ? 'running' : 'no_machine' };
}
