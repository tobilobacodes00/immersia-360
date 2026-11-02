import type { FillLevel, FillLight, FillTint } from './camera-choice';

/**
 * How the fill light looks (CAP-6). A front camera has no flash, but the screen faces the guest, so a
 * thick near-white frame around its edge lights their face. Brightness is how much of the screen the
 * frame takes and how opaque it is: the solid band is `edge` thick and fades over `glow` further in.
 * Sizes are in vmin, so the frame keeps its proportions from a phone to a kiosk TV, and stays clear of
 * the centre where the countdown sits (the widest frame ends 20 vmin in; the countdown starts about 25 in).
 */
const RING: Record<Exclude<FillLevel, 'off'>, { edge: number; glow: number; alpha: number }> = {
  soft: { edge: 4, glow: 8, alpha: 0.7 },
  bright: { edge: 8, glow: 12, alpha: 1 },
};

/** Near-white, never pure white (which clips on the camera), as space-separated sRGB. */
const TINT: Record<FillTint, string> = {
  neutral: '250 252 255',
  warm: '255 226 186',
};

/** The frame as a CSS `box-shadow`, or null when the fill light is off. */
export function fillLightShadow({ level, tint }: FillLight): string | null {
  if (level === 'off') return null;
  const { edge, glow, alpha } = RING[level];
  // An inset shadow is solid up to (spread - blur / 2) and gone by (spread + blur / 2).
  return `inset 0 0 ${glow}vmin ${edge + glow / 2}vmin rgb(${TINT[tint]} / ${alpha})`;
}
