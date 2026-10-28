import type { DeviceCapabilities, RenderPath } from '@immersia/shared';

/**
 * The render path ladder: `local` (the browser's own WebCodecs encoder) → `wasm` (a WebAssembly
 * H.264 encoder; everything else identical) → `server` (the render worker). A booth starts on the
 * best rung its device supports and falls to the next one at runtime when a render fails for a
 * reason the next rung can fix; the rung that worked is remembered, and a rung that failed for a
 * reason that will fail again is skipped for a while.
 *
 * Everything here is pure: the decisions are tested without a browser, and the booth only has to
 * store the memory and act on the answers.
 */

export const RUNGS = ['local', 'wasm', 'server'] as const satisfies readonly RenderPath[];

/** Which rungs this device can attempt at all. */
export type Availability = Record<RenderPath, boolean>;

/** What the booth has learned about this device's rungs. Plain JSON: stored on the device. */
export interface RungMemory {
  /** The rung that last produced a finished render (null: none yet). Reported to the server; not used to choose. */
  working: RenderPath | null;
  /** Rungs that failed for a device-level reason, and when. */
  failed: Partial<Record<RenderPath, { code: string; at: number }>>;
}

export const EMPTY_MEMORY: RungMemory = { working: null, failed: {} };

/**
 * Error codes (RenderError / RenderFailure) after which a LATER rung can succeed where this one
 * could not. `cancelled` and the generic `failed` are not among them: a cancelled render is the
 * operator's choice and an unexplained failure is not worth the server's cost.
 */
const FALLBACK = new Set(['unsupported_encoder', 'encoder_stall', 'gpu', 'undecodable']);

export const fallsBack = (code: string): boolean => FALLBACK.has(code);

/**
 * How long a rung stays skipped after failing with this code. Only device-level trouble counts: an
 * `undecodable` take says something about that take (the next one may be fine), not about the rung.
 * An encoder that stalled once may be a busy moment, so it is tried again sooner than one that
 * reports it cannot encode at all.
 */
export const SKIP_FOR_MS: Readonly<Record<string, number>> = {
  unsupported_encoder: 7 * 24 * 3_600_000,
  gpu: 7 * 24 * 3_600_000,
  encoder_stall: 6 * 3_600_000,
};

export function isSkipped(memory: RungMemory, rung: RenderPath, now: number): boolean {
  const f = memory.failed[rung];
  if (!f) return false;
  const ttl = SKIP_FOR_MS[f.code];
  return ttl !== undefined && now - f.at < ttl;
}

/**
 * The rungs this device can attempt, from what it reported at setup. `wasm` needs WebGL2 (the same
 * compositor) and WebAssembly; it replaces only the encoder, so a device that cannot decode or
 * composite gets nothing from it. `server` is available whenever the deployment has a render
 * worker (the caller says; the booth also learns at runtime when the server refuses).
 */
export function availableRungs(
  caps: Pick<DeviceCapabilities, 'webgl2'> & { webcodecs: Pick<DeviceCapabilities['webcodecs'], 'h264Encode'> },
  env: { wasm: boolean; server: boolean },
): Availability {
  return {
    local: caps.webcodecs.h264Encode && caps.webgl2,
    wasm: caps.webgl2 && env.wasm,
    server: env.server,
  };
}

/**
 * Where the next render starts: the first rung, from the top, that is available and not currently
 * skipped. Starting from the top (not from the rung that last worked) is what lets a device recover
 * its fast path once a skip has run out. The server is the last resort and is never skipped; when
 * nothing at all is available the answer is null.
 */
export function startRung(available: Availability, memory: RungMemory, now: number): RenderPath | null {
  for (const rung of RUNGS) {
    if (!available[rung]) continue;
    if (rung !== 'server' && isSkipped(memory, rung, now)) continue;
    return rung;
  }
  return null;
}

/**
 * After `rung` failed with `code`: the rung to try next, or null when the failure is final (not a
 * fallback code, or nothing is left). `wasm` is skipped when the problem is not the encoder.
 */
export function nextRung(
  rung: RenderPath,
  code: string,
  available: Availability,
  memory: RungMemory,
  now: number,
): RenderPath | null {
  if (!fallsBack(code)) return null;
  const encoderOnly = code === 'unsupported_encoder' || code === 'encoder_stall';
  for (const next of RUNGS.slice(RUNGS.indexOf(rung) + 1)) {
    if (!available[next]) continue;
    if (next === 'wasm' && !encoderOnly) continue;
    if (next !== 'server' && isSkipped(memory, next, now)) continue;
    return next;
  }
  return null;
}

/** Remember a failure on `rung` (only device-level codes are kept; see SKIP_FOR_MS). */
export function recordFailure(memory: RungMemory, rung: RenderPath, code: string, now: number): RungMemory {
  if (SKIP_FOR_MS[code] === undefined) return memory;
  return { ...memory, failed: { ...memory.failed, [rung]: { code, at: now } } };
}

/** Remember that `rung` finished a render. */
export function recordSuccess(memory: RungMemory, rung: RenderPath): RungMemory {
  const failed = { ...memory.failed };
  delete failed[rung];
  return { working: rung, failed };
}

/** Parse what was stored on the device; anything unexpected is a clean slate. */
export function parseMemory(raw: unknown): RungMemory {
  if (!raw || typeof raw !== 'object') return EMPTY_MEMORY;
  const r = raw as { working?: unknown; failed?: unknown };
  const working = (RUNGS as readonly unknown[]).includes(r.working) ? (r.working as RenderPath) : null;
  const failed: RungMemory['failed'] = {};
  if (r.failed && typeof r.failed === 'object') {
    for (const rung of RUNGS) {
      const f = (r.failed as Record<string, unknown>)[rung] as { code?: unknown; at?: unknown } | undefined;
      if (f && typeof f.code === 'string' && typeof f.at === 'number' && Number.isFinite(f.at))
        failed[rung] = { code: f.code, at: f.at };
    }
  }
  return { working, failed };
}
