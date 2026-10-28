import { describe, expect, it, vi } from 'vitest';
import { FONT_LIBRARY } from '@immersia/fonts';
import {
  ASPECTS,
  PRINT_SIZES,
  TOKEN_CATALOGUE,
  TOKEN_FUNCTIONS,
  contrastRatio,
  evaluate,
  onAccent,
  templateDocumentSchema,
  MAX_TEMPLATE_ELEMENTS,
  type TemplateElement,
} from '@immersia/shared';
import {
  BUILTIN_TEMPLATES,
  LIBRARY_LAYOUTS,
  LIBRARY_STYLES,
  STYLE_IDS,
  TEMPLATE_CATEGORIES,
  builtinTemplate,
  rotatedCorners,
  type BuiltinTemplate,
} from '../src/library';
import { MIN_PRINT_QR_PX, printIssues } from '../src/presets';

/** Corners of an element after its rotation, as the renderer turns it about its centre. */
const corners = (el: TemplateElement) => rotatedCorners(el, el.rotation);

/** Do two (possibly turned) rectangles overlap? Separating axis test; touching edges don't count. */
function overlap(a: TemplateElement, b: TemplateElement): boolean {
  const pa = corners(a);
  const pb = corners(b);
  for (const poly of [pa, pb]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % 4]!;
      const nx = q[1] - p[1];
      const ny = p[0] - q[0];
      const project = (pts: [number, number][]) => pts.map(([x, y]) => x * nx + y * ny);
      const ra = project(pa);
      const rb = project(pb);
      if (Math.max(...ra) <= Math.min(...rb) + 0.01 || Math.max(...rb) <= Math.min(...ra) + 0.01) return false;
    }
  }
  return true;
}

const BUILT_IN_FONTS = ['Satoshi', 'Instrument Serif'];
const libraryFamily = new Map(FONT_LIBRARY.map((f) => [f.family, f]));

describe('built-in template library (PHO-5)', () => {
  it('is big enough: 160+ templates on 60+ layouts, 15+ per category, unique ids', () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(160);
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.layoutId)).size).toBeGreaterThanOrEqual(60);
    expect(LIBRARY_LAYOUTS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.id)).size).toBe(BUILTIN_TEMPLATES.length);
    for (const c of TEMPLATE_CATEGORIES) {
      expect(BUILTIN_TEMPLATES.filter((t) => t.category === c).length, c).toBeGreaterThanOrEqual(15);
      expect(LIBRARY_STYLES.filter((s) => s.category === c).length, c).toBeGreaterThanOrEqual(3);
    }
  });

  it('names every template lib:<category>:<style>:<layout> and resolves it by id', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.id).toBe(`lib:${t.category}:${t.style}:${t.layoutId}`);
      expect(builtinTemplate(t.id)).toBe(t);
    }
    expect(builtinTemplate('lib:wedding:nope:nope')).toBeUndefined();
    expect(builtinTemplate('0190f3a0-0000-7000-8000-000000000000')).toBeUndefined();
  });

  it('keeps style ids and the message-catalogue list in step, and every layout in use', () => {
    expect(LIBRARY_STYLES.map((s) => s.id)).toEqual([...STYLE_IDS]);
    const used = new Set(BUILTIN_TEMPLATES.map((t) => t.layoutId));
    for (const l of LIBRARY_LAYOUTS) expect(used.has(l.id), l.id).toBe(true);
    expect(new Set(LIBRARY_LAYOUTS.map((l) => l.id)).size).toBe(LIBRARY_LAYOUTS.length);
    for (const l of LIBRARY_LAYOUTS) expect(l.id).toMatch(/^[a-z0-9-]+$/);
  });

  it('covers every print size and video aspect in every category, with one layout per size per style', () => {
    for (const c of TEMPLATE_CATEGORIES) {
      const of = BUILTIN_TEMPLATES.filter((t) => t.category === c);
      for (const size of PRINT_SIZES)
        expect(
          of.some((t) => t.printSize === size),
          `${c} ${size}`,
        ).toBe(true);
      for (const aspect of ASPECTS)
        expect(
          of.some((t) => t.aspect === aspect),
          `${c} ${aspect}`,
        ).toBe(true);
    }
    // Names are built from category, style, size and shots, so those must tell templates apart.
    const seen = new Set<string>();
    for (const t of BUILTIN_TEMPLATES) {
      const key = `${t.style}|${t.printSize ?? t.aspect}|${t.shots}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it('has no two layouts with the same geometry', () => {
    const seen = new Map<string, string>();
    for (const l of LIBRARY_LAYOUTS) {
      const key = JSON.stringify([l.canvas, l.geometry.photos, l.geometry.title, l.geometry.qrs, l.geometry.decos]);
      expect(seen.get(key), `${l.id} repeats ${seen.get(key)}`).toBeUndefined();
      seen.set(key, l.id);
    }
  });

  it('is deterministic and frozen', async () => {
    vi.resetModules();
    const again = await import('../src/library');
    expect(again.BUILTIN_TEMPLATES).not.toBe(BUILTIN_TEMPLATES);
    expect(JSON.stringify(again.BUILTIN_TEMPLATES)).toBe(JSON.stringify(BUILTIN_TEMPLATES));
    for (const t of BUILTIN_TEMPLATES) {
      expect(Object.isFrozen(t.doc)).toBe(true);
      expect(Object.isFrozen(t.doc.elements)).toBe(true);
    }
  });
});

describe('every built-in template', () => {
  const photosOf = (t: BuiltinTemplate) => t.doc.elements.filter((e) => e.type === 'photo');
  const qrsOf = (t: BuiltinTemplate) => t.doc.elements.filter((e) => e.type === 'qr');

  it('is a valid template document with every default filled in', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const parsed = templateDocumentSchema.safeParse(t.doc);
      expect(parsed.success, t.id).toBe(true);
      if (parsed.success) expect(parsed.data, t.id).toEqual(t.doc);
      expect(t.doc.elements.length, t.id).toBeLessThanOrEqual(MAX_TEMPLATE_ELEMENTS);
    }
  });

  it('keeps every element on the canvas', () => {
    for (const t of BUILTIN_TEMPLATES)
      for (const el of t.doc.elements)
        for (const [x, y] of corners(el)) {
          const at = `${t.id} ${el.id}`;
          expect(x, at).toBeGreaterThanOrEqual(-0.5);
          expect(y, at).toBeGreaterThanOrEqual(-0.5);
          expect(x, at).toBeLessThanOrEqual(t.doc.canvas.width + 0.5);
          expect(y, at).toBeLessThanOrEqual(t.doc.canvas.height + 0.5);
        }
  });

  it('keeps photo slots apart from each other and from the QR, and the QR clear of ornaments and text', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const photos = photosOf(t);
      for (let i = 0; i < photos.length; i++)
        for (let j = i + 1; j < photos.length; j++)
          expect(overlap(photos[i]!, photos[j]!), `${t.id} ${photos[i]!.id} / ${photos[j]!.id}`).toBe(false);
      for (const q of qrsOf(t)) {
        for (const p of photos) expect(overlap(q, p), `${t.id} ${q.id} / ${p.id}`).toBe(false);
        for (const e of t.doc.elements)
          if (e.type === 'ornament' || e.type === 'text')
            expect(overlap(q, e), `${t.id} ${q.id} / ${e.id}`).toBe(false);
      }
    }
  });

  it('takes the shots it says, numbered from the first, in slots big enough to use', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const photos = photosOf(t);
      const shots = new Set(photos.map((p) => (p.type === 'photo' ? p.shot : -1)));
      expect(shots.size, t.id).toBe(t.shots);
      for (let s = 0; s < t.shots; s++) expect(shots.has(s), `${t.id} shot ${s}`).toBe(true);
      const unit = Math.min(t.doc.canvas.width, t.doc.canvas.height);
      for (const p of photos) expect(Math.min(p.width, p.height), `${t.id} ${p.id}`).toBeGreaterThan(unit * 0.1);
    }
  });

  it('prints with a QR of at least 18 mm (DL-3), except the story, which is for screens', () => {
    for (const t of BUILTIN_TEMPLATES) {
      if (t.kind !== 'layout') continue;
      const qrs = qrsOf(t);
      expect(t.doc.canvas.printSize, t.id).toBe(t.printSize);
      expect(t.doc.canvas.background, t.id).toBe(LIBRARY_STYLES.find((s) => s.id === t.style)!.background);
      expect(photosOf(t).length, t.id).toBeGreaterThan(0);
      if (t.printSize === 'story') expect(qrs, t.id).toHaveLength(0);
      else {
        expect(qrs.length, t.id).toBeGreaterThanOrEqual(1);
        for (const q of qrs)
          if (q.type === 'qr') {
            expect(Math.min(q.width, q.height * 0.84), t.id).toBeGreaterThanOrEqual(MIN_PRINT_QR_PX);
            // Dark modules on a light plate scan in any event colours.
            expect(contrastRatio(q.dark, q.light), t.id).toBeGreaterThanOrEqual(7);
          }
      }
      expect(printIssues(t.doc), t.id).toEqual([]);
    }
  });

  it('draws overlays on a transparent canvas, with no photos and no QR', () => {
    for (const t of BUILTIN_TEMPLATES) {
      if (t.kind !== 'overlay') continue;
      expect(t.doc.canvas.background, t.id).toBe('#00000000');
      expect(t.doc.canvas.printSize, t.id).toBeNull();
      expect(photosOf(t), t.id).toHaveLength(0);
      expect(qrsOf(t), t.id).toHaveLength(0);
      expect(t.shots, t.id).toBe(0);
    }
  });

  it('uses only fonts that exist, at weights they ship', () => {
    for (const t of BUILTIN_TEMPLATES)
      for (const e of t.doc.elements) {
        if (e.type !== 'text' || BUILT_IN_FONTS.includes(e.fontFamily)) continue;
        const lib = libraryFamily.get(e.fontFamily);
        expect(lib, `${t.id} ${e.fontFamily}`).toBeDefined();
        expect(lib!.weights, `${t.id} ${e.fontFamily} weight`).toContain(e.fontWeight);
        if (e.fontStyle === 'italic') expect(lib!.italic, `${t.id} ${e.fontFamily} italic`).toBe(true);
      }
  });

  it('writes text as known tokens only: no words, nothing unresolved, nothing empty', () => {
    const known = new Set([
      ...TOKEN_CATALOGUE.flatMap((g) => g.tokens.map((x) => x.token.replace(/^\{/, '').split(/[,}]/)[0]!)),
      ...TOKEN_FUNCTIONS,
    ]);
    const context = { eventName: 'Ana & Leo', hashtag: '#ana', custom1: '', custom2: '', custom3: '' };
    for (const t of BUILTIN_TEMPLATES) {
      const texts = t.doc.elements.filter((e) => e.type === 'text');
      expect(texts.length, t.id).toBeGreaterThan(0);
      for (const e of texts) {
        if (e.type !== 'text') continue;
        for (const m of e.text.matchAll(/\{([A-Za-z0-9]+)/g)) expect(known.has(m[1]!), `${t.id}: ${e.text}`).toBe(true);
        const out = evaluate(e.text, { ...context, __date: new Date('2026-06-14T12:00:00') });
        expect(out, `${t.id}: ${e.text}`).not.toMatch(/[{}%]/);
        expect(out.trim(), `${t.id}: ${e.text}`).not.toBe('');
        // Strip fields, date codes and the `default` function; what is left must be punctuation.
        const literal = e.text.replace(/\{[A-Za-z0-9]+|%[A-Za-z]|[{},]/g, '');
        expect(literal, `${t.id}: ${e.text}`).not.toMatch(/[A-Za-z]{2,}/);
      }
    }
  });
});

describe('style palettes', () => {
  it('read: ink on the page 7:1, text 3:1 or 4.5:1, ink on a panel and on an accent block', () => {
    for (const s of LIBRARY_STYLES) {
      expect(contrastRatio(s.ink, s.background), `${s.id} ink`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(s.ink, s.secondary), `${s.id} panel`).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(s.titleColor === 'ink' ? s.ink : s.accent, s.background),
        `${s.id} title`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(s.subtitleColor === 'ink' ? s.ink : s.accent, s.background),
        `${s.id} subtitle`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(onAccent(s.accent), s.accent), `${s.id} on accent`).toBeGreaterThanOrEqual(4.5);
      // Ornaments and rules are decoration, but should still show against the page.
      expect(contrastRatio(s.accent, s.background), `${s.id} accent`).toBeGreaterThanOrEqual(3);
    }
  });

  it('pair two real fonts', () => {
    for (const s of LIBRARY_STYLES)
      for (const f of [s.display, s.body])
        expect(BUILT_IN_FONTS.includes(f.family) || libraryFamily.has(f.family), `${s.id} ${f.family}`).toBe(true);
  });
});
