import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@immersia/shared/color';

/**
 * WCAG 2.2 AA guard for the design tokens (NFR Accessibility). Reads the real stylesheet, so a token
 * edit that breaks contrast fails CI rather than shipping.
 */
const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');
const token = (name: string) => {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token --color-${name} not found`);
  return m[1]!;
};

/** Blend a colour at `alpha` over a background, as the Pill tints (e.g. bg-ok/[0.07]) render. */
function over(fg: string, alpha: number, bg: string): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(fg);
  const b = p(bg);
  return (
    '#' +
    a
      .map((c, i) =>
        Math.round(c * alpha + b[i]! * (1 - alpha))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

const TEXT_AA = 4.5;
const UI_AA = 3; // non-text: borders of inputs, focus indicators

describe('design token contrast (WCAG 2.2 AA)', () => {
  const bg = token('bg');
  const elev = token('elev');
  const sunken = token('sunken');

  it.each([
    ['fg', 'bg'],
    ['fg', 'elev'],
    ['fg', 'sunken'],
    ['muted', 'bg'],
    ['muted', 'elev'],
    ['muted', 'sunken'],
    ['faint', 'bg'],
    ['faint', 'elev'],
    ['faint', 'sunken'],
    ['accent', 'elev'],
    ['accent', 'bg'],
    ['accent', 'accent-soft'],
    ['bad', 'elev'],
    ['ok', 'elev'],
    ['warn', 'elev'],
  ])('text %s on %s ≥ 4.5:1', (fg, surface) => {
    expect(contrastRatio(token(fg), token(surface))).toBeGreaterThanOrEqual(TEXT_AA);
  });

  it('primary button: white on ink', () => {
    expect(contrastRatio('#ffffff', token('ink'))).toBeGreaterThanOrEqual(TEXT_AA);
  });

  it('status pills: tone text on its 7% tint over a card', () => {
    for (const tone of ['ok', 'warn', 'bad'])
      expect(contrastRatio(token(tone), over(token(tone), 0.07, elev)), tone).toBeGreaterThanOrEqual(TEXT_AA);
  });

  it('focus ring (accent) is visible against paper and cards', () => {
    expect(contrastRatio(token('accent'), bg)).toBeGreaterThanOrEqual(UI_AA);
    expect(contrastRatio(token('accent'), elev)).toBeGreaterThanOrEqual(UI_AA);
  });

  it('documents why `subtle` is decoration-only: it fails text contrast', () => {
    expect(contrastRatio(token('subtle'), bg)).toBeLessThan(TEXT_AA);
    expect(contrastRatio(token('subtle'), sunken)).toBeLessThan(TEXT_AA);
  });
});
