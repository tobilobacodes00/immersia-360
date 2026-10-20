import { describe, expect, it } from 'vitest';
import { ASPECTS, PRINT_SIZES } from '@immersia/shared';
import { BUILTIN_TEMPLATES, TEMPLATE_CATEGORIES, rotatedCorners, type BuiltinTemplate } from '../src/library';
import { renderTemplate } from '../src/render';

/**
 * The built-in library through the real renderer in real Chrome (PHO-5): a sample of 24 templates,
 * three per category, together covering every print size and video aspect. Fonts are not loaded here
 * (the browser falls back), which is fine: the checks are about shapes and colour, not typefaces.
 */

const SIZE_CLASSES = [...PRINT_SIZES, ...ASPECTS];
const sizeClass = (t: BuiltinTemplate) => t.printSize ?? t.aspect;

function sample(): BuiltinTemplate[] {
  return TEMPLATE_CATEGORIES.flatMap((category, c) =>
    [0, 1, 2].map((k) => {
      const size = SIZE_CLASSES[(c * 3 + k) % SIZE_CLASSES.length]!;
      const t = BUILTIN_TEMPLATES.find((x) => x.category === category && sizeClass(x) === size);
      if (!t) throw new Error(`no ${category} template for ${size}`);
      return t;
    }),
  );
}

const PLACEHOLDER = [0xe4, 0xe1, 0xda];
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (a: ArrayLike<number>, b: number[], tol: number) => [0, 1, 2].every((i) => Math.abs(a[i]! - b[i]!) <= tol);

function draw(t: BuiltinTemplate) {
  const { width, height } = t.doc.canvas;
  const scale = 480 / Math.max(width, height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  renderTemplate(
    ctx,
    t.doc,
    {
      photos: [],
      placeholders: true,
      tokens: {
        eventName: 'Ana & Leo',
        eventDate: '2026-06-14',
        hashtag: '#ana',
        custom1: '',
        __date: new Date('2026-06-14T12:00:00'),
      },
      qr: { url: 'https://immersia.example/s/k7m2pq', code: 'K7M2PQ' },
    },
    scale,
  );
  const data = ctx.getImageData(0, 0, w, h).data;
  const px = (x: number, y: number) => {
    const i =
      (Math.min(h - 1, Math.max(0, Math.round(y * scale))) * w + Math.min(w - 1, Math.max(0, Math.round(x * scale)))) *
      4;
    return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
  };
  return { data, px, scale, w, h };
}

describe('built-in templates in the renderer (PHO-5)', () => {
  const picked = sample();

  it('samples 24 templates: every category, every print size and aspect', () => {
    expect(picked).toHaveLength(24);
    for (const c of TEMPLATE_CATEGORIES) expect(picked.filter((t) => t.category === c)).toHaveLength(3);
    for (const s of SIZE_CLASSES)
      expect(
        picked.some((t) => sizeClass(t) === s),
        s,
      ).toBe(true);
  });

  for (const t of picked)
    it(`draws ${t.id} without throwing, with real content`, () => {
      const { data, px } = draw(t);
      const total = data.length / 4;
      let opaque = 0;
      let differs = 0;
      const bg = hex(t.doc.canvas.background.slice(0, 7));
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3]! > 0) opaque++;
        if (t.kind === 'layout' && !near([data[i]!, data[i + 1]!, data[i + 2]!], bg, 12)) differs++;
      }
      if (t.kind === 'layout') {
        // A print is opaque, and photo slots, text and the QR make up a good part of it.
        expect(opaque / total).toBe(1);
        expect(differs / total, 'content over the page colour').toBeGreaterThan(0.15);
      } else {
        // An overlay draws only where it has something to say: the video shows through the rest.
        expect(opaque / total, 'overlay ink').toBeGreaterThan(0.01);
        expect(opaque / total, 'overlay leaves the video visible').toBeLessThan(0.7);
      }

      // Every photo slot shows its placeholder (sampled below the numeral, clear of stickers).
      for (const el of t.doc.elements) {
        if (el.type !== 'photo') continue;
        const [a, b, , d] = rotatedCorners(el, el.rotation) as [number, number][];
        const at = [
          a![0] + (b![0] - a![0]) * 0.5 + (d![0] - a![0]) * 0.65,
          a![1] + (b![1] - a![1]) * 0.5 + (d![1] - a![1]) * 0.65,
        ];
        expect(near(px(at[0]!, at[1]!), PLACEHOLDER, 3), `${el.id} placeholder`).toBe(true);
      }

      // The QR is drawn: dark modules and the light plate in the same box.
      for (const q of t.doc.elements) {
        if (q.type !== 'qr') continue;
        let dark = 0;
        let light = 0;
        const dk = hex(q.dark);
        const lt = hex(q.light);
        for (let y = q.y; y < q.y + q.height * 0.8; y += 4)
          for (let x = q.x; x < q.x + q.width; x += 4) {
            const p = px(x, y);
            if (near(p, dk, 8)) dark++;
            else if (near(p, lt, 8)) light++;
          }
        expect(dark, `${q.id} dark modules`).toBeGreaterThan(40);
        expect(light, `${q.id} light plate`).toBeGreaterThan(40);
      }

      // The title is drawn in its colour somewhere inside its box.
      const title = t.doc.elements.find((e) => e.id === 'title');
      expect(title?.type).toBe('text');
      if (title?.type === 'text') {
        const ink = hex(title.color);
        let hits = 0;
        for (let y = title.y; y < title.y + title.height; y += 1 / 0.2)
          for (let x = title.x; x < title.x + title.width; x += 1 / 0.2) if (near(px(x, y), ink, 10)) hits++;
        expect(hits, 'title pixels').toBeGreaterThan(5);
      }
    });
});
