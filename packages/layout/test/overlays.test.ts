import { describe, expect, it } from 'vitest';
import { ASPECTS, aspectOfCanvas, overlayCanvasFor, templateDocumentSchema } from '@immersia/shared';
import { OVERLAY_STYLES, fitDocument, overlayPreset } from '../src/overlays';
import { presetTemplate } from '../src/presets';

const theme = { background: '#f7f6f2', ink: '#111110', accent: '#2b3fe6', font: 'sans' as const };

describe('overlay presets (VID-4, PHO-6)', () => {
  for (const aspect of ASPECTS)
    for (const style of OVERLAY_STYLES)
      it(`${style} at ${aspect}`, () => {
        const t = overlayPreset(aspect, style, theme);
        expect(templateDocumentSchema.safeParse(t).success).toBe(true);
        expect(t.canvas).toMatchObject({ ...overlayCanvasFor(aspect), printSize: null });
        expect(aspectOfCanvas(t.canvas)).toBe(aspect);
        // The video must show through: the canvas itself is fully transparent.
        expect(t.canvas.background.toLowerCase()).toMatch(/00$/);
        for (const el of t.elements) {
          expect(el.x).toBeGreaterThanOrEqual(0);
          expect(el.y).toBeGreaterThanOrEqual(0);
          expect(el.x + el.width).toBeLessThanOrEqual(t.canvas.width + 0.5);
          expect(el.y + el.height).toBeLessThanOrEqual(t.canvas.height + 0.5);
        }
        expect(t.elements.length === 0).toBe(style === 'blank');
      });
});

describe('fitDocument', () => {
  it('scales uniformly and centres, so nothing is distorted', () => {
    const strip = presetTemplate('2x6', { shots: 3, background: '#ffffff', ink: '#111110', font: 'sans' });
    const fitted = fitDocument(strip, 1200, 1800);
    expect(fitted.canvas).toMatchObject({ width: 1200, height: 1800, printSize: '2x6' });
    const s = 1800 / 1800; // 600×1800 → 1200×1800 is limited by height: scale 1, centred horizontally
    for (const [i, el] of fitted.elements.entries()) {
      const src = strip.elements[i]!;
      expect(el.width / src.width).toBeCloseTo(s, 2);
      expect(el.height / src.height).toBeCloseTo(s, 2);
      expect(el.x - src.x).toBeCloseTo(300, 0);
    }
    expect(templateDocumentSchema.safeParse(fitted).success).toBe(true);
  });

  it('scales type and strokes with the geometry', () => {
    const band = overlayPreset('9:16', 'frame', theme);
    const square = fitDocument(band, 540, 960);
    const text = square.elements.find((e) => e.type === 'text');
    const frame = square.elements.find((e) => e.type === 'shape');
    const srcText = band.elements.find((e) => e.type === 'text');
    const srcFrame = band.elements.find((e) => e.type === 'shape');
    if (text?.type !== 'text' || srcText?.type !== 'text') throw new Error('no text');
    if (frame?.type !== 'shape' || srcFrame?.type !== 'shape') throw new Error('no frame');
    expect(text.fontSize).toBeCloseTo(srcText.fontSize / 2, 0);
    expect(frame.strokeWidth).toBeCloseTo(srcFrame.strokeWidth / 2, 1);
  });
});
