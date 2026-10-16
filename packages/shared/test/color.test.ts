import { describe, expect, it } from 'vitest';
import { INK, WHITE, contrastRatio, onAccent, parseHex, relativeLuminance } from '../src/color';
import { THEME_PRESETS, guestThemeVars } from '../src/theme';

describe('colour maths', () => {
  it('parses 3- and 6-digit hex', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('2b3fe6')).toEqual([0x2b, 0x3f, 0xe6]);
    expect(parseHex('nope')).toBeNull();
  });

  it('matches WCAG reference values', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe('onAccent', () => {
  it('chooses the higher-contrast text colour', () => {
    expect(onAccent('#2b3fe6')).toBe(WHITE);
    expect(onAccent('#f5d90a')).toBe(INK);
    expect(onAccent('#111110')).toBe(WHITE);
  });

  it('never does worse than the old fixed 0.42 threshold', () => {
    for (let r = 0; r < 256; r += 17)
      for (let g = 0; g < 256; g += 17)
        for (let b = 0; b < 256; b += 17) {
          const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
          const legacy = relativeLuminance(hex) > 0.42 ? INK : WHITE;
          expect(contrastRatio(hex, onAccent(hex))).toBeGreaterThanOrEqual(contrastRatio(hex, legacy) - 1e-9);
        }
  });

  it('falls back to white on invalid input', () => {
    expect(onAccent('garbage')).toBe(WHITE);
  });
});

describe('theme presets', () => {
  it('every preset meets WCAG AA for ink on background and button text on accent', () => {
    for (const { name, theme } of THEME_PRESETS) {
      expect(contrastRatio(theme.ink, theme.background), `${name} ink/bg`).toBeGreaterThanOrEqual(4.5);
      const vars = guestThemeVars(theme);
      expect(contrastRatio(theme.accent, vars['--g-on-accent']!), `${name} on-accent`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
