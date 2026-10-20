/**
 * The camera's own light (CAP-6). Chrome on Android exposes a torch on cameras that have one; iOS
 * Safari generally does not, and either throws or quietly ignores the request, so a result says
 * which of "not supported" and "failed" happened instead of pretending it worked.
 */
import { applyAdvanced, capabilitiesOf, settingsOf, type ConstrainableTrack } from './track';

export type TorchResult = { ok: true; on: boolean } | { ok: false; reason: 'unsupported' | 'failed' };

/** Whether the track reports a controllable torch. */
export function torchSupported(track: ConstrainableTrack): boolean {
  return Boolean(capabilitiesOf(track).torch);
}

/** Errors a browser raises for a constraint it does not implement for this camera. */
const UNSUPPORTED_ERRORS = new Set(['OverconstrainedError', 'NotSupportedError', 'TypeError']);

/**
 * Turn the torch on or off. Never throws. Where the browser accepts the constraint but the track's
 * settings still say otherwise (iOS ignores it on cameras without a light), that is "unsupported".
 * Apply it again after every camera restart: closing the camera switches the light off.
 */
export async function setTorch(track: ConstrainableTrack, on: boolean): Promise<TorchResult> {
  if (!torchSupported(track)) return { ok: false, reason: 'unsupported' };
  try {
    await applyAdvanced(track, { torch: on });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name ?? '';
    return { ok: false, reason: UNSUPPORTED_ERRORS.has(name) ? 'unsupported' : 'failed' };
  }
  const actual = settingsOf(track).torch;
  if (typeof actual === 'boolean' && actual !== on) return { ok: false, reason: 'unsupported' };
  return { ok: true, on };
}
