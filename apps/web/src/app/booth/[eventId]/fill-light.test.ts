import { describe, expect, it } from 'vitest';
import type { FillLight } from './camera-choice';
import { fillLightShadow } from './fill-light';

/** `inset 0 0 {blur}vmin {spread}vmin rgb(r g b / a)` taken apart. */
function parse(fill: FillLight) {
  const css = fillLightShadow(fill);
  const m = css && /^inset 0 0 ([\d.]+)vmin ([\d.]+)vmin rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(css);
  if (!m) throw new Error(`unexpected shadow: ${css}`);
  const [blur, spread, r, g, b, alpha] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return {
    blur,
    spread,
    rgb: [r, g, b] as const,
    alpha,
    /** Where the solid band ends, and where the glow has faded out. */
    solid: spread - blur / 2,
    reach: spread + blur / 2,
  };
}

describe('fillLightShadow (CAP-6)', () => {
  it('draws nothing when off, whatever the tint', () => {
    expect(fillLightShadow({ level: 'off', tint: 'neutral' })).toBeNull();
    expect(fillLightShadow({ level: 'off', tint: 'warm' })).toBeNull();
  });

  it('is an inset glow in vmin, so it keeps its proportions on any screen', () => {
    expect(fillLightShadow({ level: 'soft', tint: 'neutral' })).toMatch(/^inset 0 0 [\d.]+vmin [\d.]+vmin rgb\(/);
  });

  it('bright is a thicker, more opaque ring than soft', () => {
    const soft = parse({ level: 'soft', tint: 'neutral' });
    const bright = parse({ level: 'bright', tint: 'neutral' });
    expect(bright.solid).toBeGreaterThan(soft.solid);
    expect(bright.reach).toBeGreaterThan(soft.reach);
    expect(bright.alpha).toBeGreaterThan(soft.alpha);
    expect(bright.alpha).toBeLessThanOrEqual(1);
    // A thick border, not a hairline.
    expect(soft.solid).toBeGreaterThanOrEqual(3);
  });

  it('stays clear of the middle of the screen, where the countdown and the QR are', () => {
    for (const level of ['soft', 'bright'] as const) {
      // The countdown disc starts about 25 vmin in from the edge.
      expect(parse({ level, tint: 'warm' }).reach).toBeLessThanOrEqual(20);
    }
  });

  it('is near-white in both tints, warm being the warmer', () => {
    const neutral = parse({ level: 'bright', tint: 'neutral' }).rgb;
    const warm = parse({ level: 'bright', tint: 'warm' }).rgb;
    for (const channel of [...neutral, ...warm]) expect(channel).toBeGreaterThanOrEqual(180);
    // Pure white clips on the camera.
    expect(neutral.some((c) => c < 255)).toBe(true);
    // Warm drops blue the most; neutral stays level.
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(Math.abs(neutral[0] - neutral[2])).toBeLessThan(warm[0] - warm[2]);
  });

  it('tint changes the colour and nothing else', () => {
    const neutral = parse({ level: 'soft', tint: 'neutral' });
    const warm = parse({ level: 'soft', tint: 'warm' });
    expect({ ...neutral, rgb: 0 }).toEqual({ ...warm, rgb: 0 });
    expect(neutral.rgb).not.toEqual(warm.rgb);
  });
});
