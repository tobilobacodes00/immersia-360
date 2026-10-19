import { describe, expect, it } from 'vitest';
import { CATALOGUE, FONT_CATEGORIES, slugOf } from '../src/catalogue';
import { FONT_LIBRARY, findFamily } from '../src/library';
import { FONT_MANIFEST } from '../src/manifest';
import { deriveRuntime } from '../scripts/runtime.mjs';
import runtime from '../src/runtime.json';
import { fontStack } from '../src/load';

const MINIMUM = { sans: 30, serif: 25, display: 25, handwriting: 20, mono: 5 };
const byCodepoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe('font catalogue (PHO-9)', () => {
  it('offers at least 110 families', () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(110);
  });

  it('has unique family names and slugs, the slug being the kebab-case name', () => {
    expect(new Set(CATALOGUE.map((c) => c.family.toLowerCase())).size).toBe(CATALOGUE.length);
    expect(new Set(CATALOGUE.map((c) => c.slug)).size).toBe(CATALOGUE.length);
    for (const c of CATALOGUE) {
      expect(c.slug, c.family).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.slug, c.family).toBe(slugOf(c.family));
    }
  });

  it('uses known categories, with enough families in each', () => {
    for (const c of CATALOGUE) expect(FONT_CATEGORIES, c.family).toContain(c.category);
    for (const category of FONT_CATEGORIES) {
      const count = CATALOGUE.filter((c) => c.category === category).length;
      expect(count, category).toBeGreaterThanOrEqual(MINIMUM[category]);
    }
  });

  it('is open-licence only: OFL 1.1 or Apache 2.0', () => {
    for (const c of CATALOGUE) expect(['OFL-1.1', 'Apache-2.0'], c.family).toContain(c.licence);
  });

  it('lists sensible weights, and an italic only for a handful of families', () => {
    for (const c of CATALOGUE) {
      expect(c.weights.length, c.family).toBeGreaterThan(0);
      expect(c.weights, c.family).toEqual([...new Set(c.weights)].sort((a, b) => a - b));
      for (const w of c.weights) expect(w % 100 === 0 && w >= 100 && w <= 900, `${c.family} ${w}`).toBe(true);
    }
    const italics = CATALOGUE.filter((c) => c.italic);
    expect(italics.length).toBeGreaterThan(0);
    expect(italics.length).toBeLessThanOrEqual(15);
  });

  it('leaves out the built-ins, which the app loads itself', () => {
    const names = CATALOGUE.map((c) => c.family.toLowerCase());
    expect(names).not.toContain('instrument serif');
    expect(names).not.toContain('satoshi');
  });

  it('includes the classic wedding scripts', () => {
    const scripts = CATALOGUE.filter((c) => c.category === 'handwriting').map((c) => c.family);
    for (const name of ['Great Vibes', 'Parisienne', 'Allura', 'Pinyon Script', 'Alex Brush'])
      expect(scripts).toContain(name);
  });
});

describe('font library manifest (library.json)', () => {
  it('is in step with the catalogue (after editing it, run `pnpm --filter @immersia/fonts generate`)', () => {
    const summary = (f: (typeof CATALOGUE)[number]) => ({
      family: f.family,
      slug: f.slug,
      category: f.category,
      weights: f.weights,
      italic: f.italic,
      licence: f.licence,
    });
    expect(FONT_LIBRARY.map(summary)).toEqual(
      [...CATALOGUE].sort((a, b) => byCodepoint(a.family, b.family)).map(summary),
    );
  });

  it('has every catalogue weight, and the 400 italic where asked, in latin', () => {
    for (const f of FONT_LIBRARY) {
      const expected = [...f.weights.map((w) => `${w}-normal`), ...(f.italic ? ['400-italic'] : [])].sort();
      const faces = (subset: string) =>
        f.files
          .filter((x) => x.subset === subset)
          .map((x) => `${x.weight}-${x.style}`)
          .sort();
      expect(faces('latin'), f.family).toEqual(expected);
      // latin-ext only exists where the font has those glyphs; when it does, it covers every face.
      const ext = faces('latin-ext');
      expect(ext.length === 0 || JSON.stringify(ext) === JSON.stringify(expected), f.family).toBe(true);
    }
  });

  const withoutExt = FONT_LIBRARY.filter((f) => !f.files.some((x) => x.subset === 'latin-ext')).map((f) => f.family);
  it(`has latin-ext for nearly every family (Google Fonts has none for: ${withoutExt.join(', ')})`, () => {
    expect(withoutExt.length).toBeLessThanOrEqual(FONT_LIBRARY.length * 0.15);
  });

  it('names its files <slug>/<weight>-<style>-<subset>.woff2, each once', () => {
    const paths = FONT_LIBRARY.flatMap((f) => f.files.map((x) => ({ family: f, file: x })));
    for (const { family, file } of paths) {
      expect(file.file).toMatch(/^[a-z0-9-]+\/[0-9]{3}-(normal|italic)-(latin|latin-ext)\.woff2$/);
      expect(file.file).toBe(`${family.slug}/${file.weight}-${file.style}-${file.subset}.woff2`);
    }
    expect(new Set(paths.map((p) => p.file.file)).size).toBe(paths.length);
  });

  it('pins every file by a static gstatic URL, sha256 and size', () => {
    const bySha = new Map<string, number>();
    const bySource = new Map<string, string>();
    for (const f of FONT_MANIFEST)
      for (const x of f.files) {
        expect(x.sha256, x.file).toMatch(/^[0-9a-f]{64}$/);
        expect(x.bytes, x.file).toBeGreaterThan(1000);
        expect(x.source, x.file).toMatch(/^https:\/\/fonts\.gstatic\.com\/s\/[a-z0-9]+\/v\d+\/[^/]+\.woff2$/);
        expect(x.unicodeRange, x.file).toMatch(/^U\+[0-9A-F]/);
        // The same bytes are the same URL and size, so the build can fetch a variable font once.
        expect(bySha.get(x.sha256) ?? x.bytes, x.file).toBe(x.bytes);
        expect(bySource.get(x.source) ?? x.sha256, x.file).toBe(x.sha256);
        bySha.set(x.sha256, x.bytes);
        bySource.set(x.source, x.sha256);
      }
  });

  it("keeps each font's own copyright line", () => {
    for (const f of FONT_MANIFEST) expect(f.copyright.trim().length, f.family).toBeGreaterThan(0);
  });

  it('ships browsers a runtime view that matches the manifest exactly', () => {
    // runtime.json is generated from library.json (scripts/runtime.mjs); a stale copy fails here.
    expect(runtime).toEqual(deriveRuntime(FONT_MANIFEST));
    expect(FONT_LIBRARY.map((f) => f.files.map((x) => x.file))).toEqual(
      FONT_MANIFEST.map((f) => f.files.map((x) => x.file)),
    );
  });

  it('finds a family by name, ignoring case', () => {
    expect(findFamily('Great Vibes')?.slug).toBe('great-vibes');
    expect(findFamily('  great vibes ')?.family).toBe('Great Vibes');
    expect(findFamily('Satoshi')).toBeUndefined();
    expect(findFamily('')).toBeUndefined();
  });
});

describe('fontStack', () => {
  const fallback = {
    sans: 'system-ui, sans-serif',
    serif: 'Georgia, serif',
    display: 'sans-serif',
    handwriting: 'cursive',
    mono: 'ui-monospace, monospace',
  };

  it('quotes the family and falls back by category', () => {
    expect(fontStack('Inter')).toBe('"Inter", system-ui, sans-serif');
    expect(fontStack('Lora')).toBe('"Lora", Georgia, serif');
    expect(fontStack('Bebas Neue')).toBe('"Bebas Neue", sans-serif');
    expect(fontStack('Great Vibes')).toBe('"Great Vibes", cursive');
    expect(fontStack('JetBrains Mono')).toBe('"JetBrains Mono", ui-monospace, monospace');
  });

  it('does this for every family in the catalogue', () => {
    for (const c of CATALOGUE) expect(fontStack(c.family), c.family).toBe(`"${c.family}", ${fallback[c.category]}`);
  });

  it('falls back to sans-serif for a family it does not know, such as an uploaded one', () => {
    expect(fontStack('Acme Wedding Script')).toBe('"Acme Wedding Script", sans-serif');
  });

  it('matches names without regard to case, and escapes quotes in them', () => {
    expect(fontStack('lora')).toBe('"lora", Georgia, serif');
    expect(fontStack('My "Quoted" \\ Font')).toBe('"My \\"Quoted\\" \\\\ Font", sans-serif');
  });
});
