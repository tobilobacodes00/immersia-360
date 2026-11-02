import {
  nextRung,
  recordFailure,
  recordSuccess,
  startRung,
  type Availability,
  type RungMemory,
} from '@immersia/render-engine/ladder';
import type { RenderPath } from '@immersia/shared';

/**
 * One take's walk down the render ladder (`local` → `wasm` → `server`), with the real work injected.
 * It starts on the best rung the device can use and has not recently failed, falls to the next rung when
 * a render fails for a reason the next rung can fix (see `fallsBack` in @immersia/render-engine), and
 * returns the memory to keep: the rung that worked, and the rungs that did not.
 */

export type LadderOutcome<R> =
  /** A rung on this device produced the video (`result` is what the attempt returned). */
  | { kind: 'rendered'; rung: 'local' | 'wasm'; memory: RungMemory; result: R }
  /** The take was handed to the server render worker; its video lands in the guest's session from there. */
  | { kind: 'server'; memory: RungMemory }
  /** No rung could do it. `code` is a RenderFailure code (what the operator reads). */
  | { kind: 'failed'; code: string; rung: RenderPath | null; memory: RungMemory };

export interface LadderDeps<R> {
  available: Availability;
  memory: RungMemory;
  now: number;
  /**
   * A test hook: rungs forced to fail as if their encoder were missing (the booth only passes this on a
   * server running in E2E mode, never in production). The real next rung then renders for real.
   */
  forced?: readonly RenderPath[];
  /** Render on this device with the browser's encoder (`local`) or the WebAssembly one (`wasm`). Rejects with a `code`. */
  attempt(rung: 'local' | 'wasm'): Promise<R>;
  /** Hand the take to the server rung. Rejects only when it can not even be handed over. */
  toServer(): Promise<void>;
}

/** The failure code of anything a rung threw (RenderFailure and RenderError carry one). */
export function codeOfFailure(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'failed';
}

export async function runLadder<R>(deps: LadderDeps<R>): Promise<LadderOutcome<R>> {
  const { available, now } = deps;
  let memory = deps.memory;
  let rung = startRung(available, memory, now);
  // No rung at all: no encoder here, no WebAssembly, no server worker. Say so as the encoder's absence.
  if (!rung) return { kind: 'failed', code: 'unsupported_encoder', rung: null, memory };

  for (;;) {
    if (rung === 'server') {
      try {
        await deps.toServer();
        // Handed over, not done: the server rung counts as worked when the job's video is there.
        return { kind: 'server', memory };
      } catch (err) {
        return { kind: 'failed', code: codeOfFailure(err), rung, memory };
      }
    }
    try {
      if (deps.forced?.includes(rung)) {
        throw Object.assign(new Error(`${rung} rung forced to fail`), { code: 'unsupported_encoder' });
      }
      const result = await deps.attempt(rung);
      return { kind: 'rendered', rung, memory: recordSuccess(memory, rung), result };
    } catch (err) {
      const code = codeOfFailure(err);
      memory = recordFailure(memory, rung, code, now);
      const next = nextRung(rung, code, available, memory, now);
      if (!next) return { kind: 'failed', code, rung, memory };
      rung = next;
    }
  }
}
