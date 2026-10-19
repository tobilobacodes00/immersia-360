import { type EffectDef } from './contract';
import { AURA, CLONES, ECHO_TRAIL, SMOKE } from './shaders/image';
import { DISCO, FILM_BURN, LIGHT_LEAK, LIGHT_RINGS, PRISM_FLARE, STROBE } from './shaders/lights';
import { BUBBLES, CONFETTI, HEARTS, SNOW, SPARKLE } from './shaders/particles';
import { GLITCH, RGB_SHIFT, VHS } from './shaders/distort';

export { STROBE_MAX_BPM, STROBE_PEAK_LIFT } from './shaders/lights';

/**
 * The video effect pack (VID-7: at least 16, original; VID-12: every one of them keeps time with the
 * music through uBeat / uPulse). Order is the order the picker shows them in.
 *
 * Host requirements, beyond the contract's uniforms:
 *  - vUv follows the contract: (0, 0) is the BOTTOM-left of the picture, so things fall towards decreasing
 *    y. A host whose vertex shader is y-down must flip vUv for these shaders, or confetti will rise.
 *  - The strobe flashes once per beat and cannot see the tempo, so the 3-flashes-per-second ceiling holds
 *    only while the beat grid stays at or below STROBE_MAX_BPM: fold faster tempos down before they reach
 *    uBeat / uPulse.
 */
export const EFFECTS: readonly EffectDef[] = [
  LIGHT_RINGS,
  CONFETTI,
  SPARKLE,
  HEARTS,
  BUBBLES,
  SNOW,
  SMOKE,
  AURA,
  DISCO,
  PRISM_FLARE,
  LIGHT_LEAK,
  FILM_BURN,
  STROBE,
  GLITCH,
  RGB_SHIFT,
  VHS,
  ECHO_TRAIL,
  CLONES,
];

const BY_ID = new Map(EFFECTS.map((effect) => [effect.id, effect] as const));

export function findEffect(id: string): EffectDef | undefined {
  return BY_ID.get(id);
}
