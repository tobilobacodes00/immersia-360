import { describe, expect, it } from 'vitest';
import { PRINT_SIZES, canvasSizeFor, mmToPx, templateElementSchema } from '@immersia/shared';
import { MIN_PRINT_QR_PX, presetTemplate, printIssues, type Shots } from '../src/presets';
import { printDocument } from '../src/print';
import { shotsIn } from '../src/render';

const theme = { background: '#f7f6f2', ink: '#111110', font: 'sans' as const };
const overlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('preset layouts (PHO-1, PHO-3, DL-3)', () => {
  for (const size of PRINT_SIZES)
    for (const shots of [1, 2, 3, 4] as Shots[])
      it(`${size} with ${shots} shot${shots > 1 ? 's' : ''}`, () => {
        const t = presetTemplate(size, { ...theme, shots });
        const { width, height } = canvasSizeFor(size);
        expect(t.canvas).toMatchObject({ width, height, printSize: size });
        expect(shotsIn(t)).toBe(shots);
        // Every element is valid against the shared schema and lies on the canvas.
        for (const el of t.elements) {
          expect(templateElementSchema.safeParse(el).success, el.id).toBe(true);
          expect(el.x).toBeGreaterThanOrEqual(0);
          expect(el.y).toBeGreaterThanOrEqual(0);
          expect(el.x + el.width).toBeLessThanOrEqual(width);
          expect(el.y + el.height).toBeLessThanOrEqual(height);
        }
        const photos = t.elements.filter((e) => e.type === 'photo');
        // Photos never overlap each other, or the title panel.
        for (let i = 0; i < photos.length; i++)
          for (let j = i + 1; j < photos.length; j++) expect(overlap(photos[i]!, photos[j]!)).toBe(false);
        for (const el of t.elements.filter((e) => e.type !== 'photo'))
          for (const p of photos) expect(overlap(el, p), `${el.id} over ${p.id}`).toBe(false);
        // Photos are usable: no sliver frames.
        for (const p of photos) expect(Math.min(p.width, p.height)).toBeGreaterThan(Math.min(width, height) * 0.2);
        // DL-3: printed sizes carry a QR at least 18 mm wide; the 9:16 story is digital-only.
        const qr = t.elements.find((e) => e.type === 'qr');
        if (size === 'story') expect(qr).toBeUndefined();
        else expect(Math.min(qr!.width, qr!.height * 0.84)).toBeGreaterThanOrEqual(MIN_PRINT_QR_PX - 0.5);
        expect(printIssues(t)).toEqual([]);
      });

  it('flags a printed QR under 18 mm', () => {
    const t = presetTemplate('4x6', { ...theme, shots: 4 });
    const qr = t.elements.find((e) => e.type === 'qr')!;
    qr.width = qr.height = Math.round(mmToPx(12));
    expect(printIssues(t)).toContain('qr_too_small');
  });

  it('18 mm is 213 px at 300 DPI', () => {
    expect(MIN_PRINT_QR_PX).toBe(213);
  });
});

describe('print document (PHO-7, PHO-8)', () => {
  it('sizes the page to the paper exactly, with no margins', () => {
    const html = printDocument('blob:x', { image: new Blob(), widthIn: 4, heightIn: 6 });
    expect(html).toContain('@page { size: 4in 6in; margin: 0 }');
    expect(html.match(/class="page"/g)).toHaveLength(1);
  });

  it('two-up puts two 2×6 strips on one 4×6 sheet', () => {
    const html = printDocument('blob:x', { image: new Blob(), widthIn: 2, heightIn: 6, twoUp: true });
    expect(html).toContain('@page { size: 4in 6in; margin: 0 }');
    expect(html.match(/<img /g)).toHaveLength(2);
  });

  it('prints each copy as its own page (kiosk printing has no copies field), capped at 10', () => {
    expect(
      printDocument('blob:x', { image: new Blob(), widthIn: 4, heightIn: 6, copies: 3 }).match(/class="page"/g),
    ).toHaveLength(3);
    expect(
      printDocument('blob:x', { image: new Blob(), widthIn: 4, heightIn: 6, copies: 50 }).match(/class="page"/g),
    ).toHaveLength(10);
  });
});
