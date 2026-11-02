import { describe, expect, it } from 'vitest';
import { ORNAMENTS, templateElementSchema } from '@immersia/shared';
import { EVEN_ODD, ornamentPath } from '../src/ornaments';
import { renderTemplate } from '../src/render';

const coverage = (ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) => {
  const data = ctx.getImageData(0, 0, w, h).data;
  let on = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 128) on++;
  return on / (w * h);
};

describe('ornaments (PHO-4, PHO-5)', () => {
  for (const name of ORNAMENTS)
    it(`${name} draws a shape that fits its box`, () => {
      const c = new OffscreenCanvas(120, 120);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fill(ornamentPath(name, 120, 120), EVEN_ODD.has(name) ? 'evenodd' : 'nonzero');
      const f = coverage(ctx, 120, 120);
      // Something visible, and not a filled square (a broken path tends to flood the box).
      expect(f, name).toBeGreaterThan(0.02);
      expect(f, name).toBeLessThan(0.9);
    });

  it('keeps its aspect in a wide box, centred', () => {
    const c = new OffscreenCanvas(300, 100);
    const ctx = c.getContext('2d')!;
    ctx.fill(ornamentPath('heart', 300, 100));
    const data = ctx.getImageData(0, 0, 300, 100).data;
    const alphaAt = (x: number, y: number) => data[(y * 300 + x) * 4 + 3]!;
    // Nothing in the outer thirds: the heart is a 100×100 square in the middle.
    for (let y = 0; y < 100; y += 5) {
      expect(alphaAt(20, y)).toBe(0);
      expect(alphaAt(280, y)).toBe(0);
    }
    expect(alphaAt(150, 55)).toBeGreaterThan(128);
  });

  it('renders as a template element in its colour', () => {
    const el = templateElementSchema.parse({
      id: 'o',
      type: 'ornament',
      ornament: 'star',
      color: '#2b3fe6',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const c = new OffscreenCanvas(100, 100);
    const ctx = c.getContext('2d')!;
    renderTemplate(
      ctx,
      {
        canvas: { width: 100, height: 100, dpi: 300, printSize: null, background: '#ffffff', backgroundAssetId: null },
        elements: [el],
      },
      { photos: [], tokens: {} },
    );
    const [r, g, b] = ctx.getImageData(50, 55, 1, 1).data;
    expect([r, g, b]).toEqual([0x2b, 0x3f, 0xe6]);
  });
});
