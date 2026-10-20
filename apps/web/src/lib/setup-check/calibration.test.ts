import { describe, expect, it } from 'vitest';
import { PRINT_DPI, PRINT_SIZES, PRINT_SIZE_INCHES, canvasSizeFor } from '@immersia/shared';
import {
  FRAME_INSETS_MM,
  MARK_INSET_MM,
  RULER_MM,
  bounds,
  calibrationSheet,
  pxPerMm,
  type Primitive,
} from './calibration';

const sheet = (size: (typeof PRINT_SIZES)[number]) => {
  const { width, height } = canvasSizeFor(size);
  return { width, height, ...calibrationSheet(width, height, PRINT_DPI, `${size} in`) };
};
const mm = pxPerMm(PRINT_DPI);

const lines = (ps: Primitive[]) => ps.filter((p): p is Extract<Primitive, { kind: 'line' }> => p.kind === 'line');

describe('printer calibration sheet (HLP-1)', () => {
  it('300 DPI is 11.811 pixels per millimetre', () => {
    expect(mm).toBeCloseTo(11.811, 3);
  });

  it.each(PRINT_SIZES.filter((s) => PRINT_SIZE_INCHES[s]))('%s: everything stays on the sheet', (size) => {
    const s = sheet(size);
    for (const p of s.primitives) {
      const b = bounds(p);
      // Text is anchored at one point, centred: only its anchor has to be on the sheet.
      expect(b.minX, JSON.stringify(p)).toBeGreaterThanOrEqual(-0.001);
      expect(b.minY, JSON.stringify(p)).toBeGreaterThanOrEqual(-0.001);
      expect(b.maxX, JSON.stringify(p)).toBeLessThanOrEqual(s.width + 0.001);
      expect(b.maxY, JSON.stringify(p)).toBeLessThanOrEqual(s.height + 0.001);
    }
  });

  it('draws frames 1, 2, 3 and 4 mm in from every edge', () => {
    const s = sheet('4x6');
    const rects = s.primitives.filter((p): p is Extract<Primitive, { kind: 'rect' }> => p.kind === 'rect');
    expect(rects).toHaveLength(FRAME_INSETS_MM.length);
    FRAME_INSETS_MM.forEach((inset, i) => {
      const r = rects[i]!;
      expect(r.x).toBeCloseTo(inset * mm, 6);
      expect(r.y).toBeCloseTo(inset * mm, 6);
      expect(r.x + r.w).toBeCloseTo(s.width - inset * mm, 6);
      expect(r.y + r.h).toBeCloseTo(s.height - inset * mm, 6);
    });
  });

  it('has a corner mark in each corner at the stated inset', () => {
    const s = sheet('4x6');
    const l = lines(s.primitives);
    const at = (x: number, y: number) => l.filter((p) => Math.abs(p.x1 - x) < 0.01 && Math.abs(p.y1 - y) < 0.01);
    const m = MARK_INSET_MM * mm;
    for (const [x, y] of [
      [m, m],
      [s.width - m, m],
      [m, s.height - m],
      [s.width - m, s.height - m],
    ] as const)
      expect(at(x, y), `corner ${x},${y}`).toHaveLength(2);
  });

  it('states the distance between the corner marks in millimetres', () => {
    // 4×6 in = 101.6 × 152.4 mm; the marks are 6 mm in from each edge.
    expect(sheet('4x6').marksMm).toEqual({ w: 89.6, h: 140.4 });
    expect(sheet('2x6').marksMm).toEqual({ w: 38.8, h: 140.4 });
  });

  it.each(['2x6', '4x4', '4x6', '6x4', '5x7'] as const)(
    '%s: the ruler is exactly 50 mm with a tick at every millimetre',
    (size) => {
      const s = sheet(size);
      for (const r of s.rulers) {
        expect(r.lengthPx / mm).toBeCloseTo(RULER_MM, 9);
        const along = (p: Extract<Primitive, { kind: 'line' }>) =>
          r.orientation === 'h' ? [p.x1, p.x2] : [p.y1, p.y2];
        const across = (p: Extract<Primitive, { kind: 'line' }>) =>
          r.orientation === 'h' ? [p.y1, p.y2] : [p.x1, p.x2];
        const ticks = lines(s.primitives).filter((p) => {
          const [a1, a2] = along(p) as [number, number];
          const [c1, c2] = across(p) as [number, number];
          const start = r.orientation === 'h' ? r.x : r.y;
          const base = r.orientation === 'h' ? r.y : r.x;
          // A tick runs across the ruler, from its baseline, at one position along it.
          return (
            Math.abs(a1 - a2) < 1e-9 &&
            Math.abs(c1 - base) < 1e-9 &&
            a1 >= start - 1e-6 &&
            a1 <= start + r.lengthPx + 1e-6 &&
            c2 !== c1
          );
        });
        expect(ticks).toHaveLength(RULER_MM + 1);
        const positions = ticks.map((p) => (along(p)[0]! - (r.orientation === 'h' ? r.x : r.y)) / mm);
        positions.forEach((pos, i) => expect(pos).toBeCloseTo(i, 6));
      }
    },
  );

  it('a 2 inch strip has no room for a horizontal 50 mm ruler, wider sheets get both', () => {
    expect(sheet('2x6').rulers.map((r) => r.orientation)).toEqual(['v']);
    expect(sheet('4x6').rulers.map((r) => r.orientation)).toEqual(['v', 'h']);
    expect(sheet('6x4').rulers.map((r) => r.orientation)).toEqual(['v', 'h']);
  });

  it('draws a 20 mm circle in the middle', () => {
    const s = sheet('4x6');
    const c = s.primitives.find((p): p is Extract<Primitive, { kind: 'circle' }> => p.kind === 'circle')!;
    expect(c.r * 2).toBeCloseTo(20 * mm, 6);
    expect(c.cx).toBeCloseTo(s.width / 2, 6);
    expect(c.cy).toBeCloseTo(s.height / 2, 6);
  });

  it('carries names and numbers only, so it needs no translation', () => {
    const texts = sheet('4x6')
      .primitives.filter((p): p is Extract<Primitive, { kind: 'text' }> => p.kind === 'text')
      .map((p) => p.text);
    expect(texts).toContain('Immersia 360 · 4x6 in');
    expect(texts).toContain('1 · 2 · 3 · 4 mm');
    expect(texts).toContain('89.6 × 140.4 mm');
    // Both rulers end in "50 mm".
    expect(texts.filter((t) => t === '50 mm')).toHaveLength(2);
    expect(texts.filter((t) => t === '0')).toHaveLength(2);
  });

  it('the sheet is exactly the print size at 300 DPI', () => {
    expect(canvasSizeFor('4x6')).toEqual({ width: 1200, height: 1800 });
    expect(canvasSizeFor('2x6')).toEqual({ width: 600, height: 1800 });
  });
});
