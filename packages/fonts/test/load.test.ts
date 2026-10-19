import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FONT_LIBRARY, findFamily } from '../src/library';

/**
 * The loader against a fake FontFace / FontFaceSet: what gets registered, with which descriptors,
 * and how requests are shared and retried. (Real fonts in a real browser are the web app's E2E.)
 */

// Behaves like an engine that parses the family as a CSS name when `strictFamilies` is set.
const parsesAsCss = (family: string) =>
  family.startsWith('"') || family.split(' ').every((w) => /^[A-Za-z_-][\w-]*$/.test(w));

class FakeFace {
  static created: FakeFace[] = [];
  static failLoads = false;
  static strictFamilies = false;
  status = 'unloaded';

  constructor(
    readonly family: string,
    readonly source: string | ArrayBuffer,
    readonly descriptors: FontFaceDescriptors = {},
  ) {
    FakeFace.created.push(this);
  }

  async load() {
    if (FakeFace.failLoads) throw new Error('network error');
    if (FakeFace.strictFamilies && !parsesAsCss(this.family)) throw new DOMException('bad family', 'SyntaxError');
    this.status = 'loaded';
    return this;
  }
}

class FakeSet {
  faces = new Set<FakeFace>();
  add(face: FakeFace) {
    this.faces.add(face);
    return this;
  }
  delete(face: FakeFace) {
    return this.faces.delete(face);
  }
}

let set: FakeSet;

// Each test gets a fresh module, so the loader's request cache starts empty.
async function loader() {
  vi.resetModules();
  return import('../src/load');
}

beforeEach(() => {
  FakeFace.created = [];
  FakeFace.failLoads = false;
  FakeFace.strictFamilies = false;
  set = new FakeSet();
  vi.stubGlobal('FontFace', FakeFace);
  vi.stubGlobal('fonts', set);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sourceOf = (face: FakeFace) => String(face.source);

describe('loadLibraryFamily', () => {
  it('registers and loads one face per matching file, described as the library says', async () => {
    const { loadLibraryFamily } = await loader();
    await loadLibraryFamily('Lora', { weights: [400] });
    const files = findFamily('Lora')!.files.filter((f) => f.weight === 400);
    expect(files.length).toBeGreaterThan(0);
    expect(FakeFace.created).toHaveLength(files.length);
    expect(set.faces.size).toBe(files.length);
    for (const file of files) {
      const face = FakeFace.created.find(
        (f) => f.descriptors.unicodeRange === file.unicodeRange && f.descriptors.style === file.style,
      )!;
      expect(face.family).toBe('Lora');
      expect(face.descriptors).toEqual({
        weight: '400',
        style: file.style,
        unicodeRange: file.unicodeRange,
        display: 'block',
      });
      expect(face.status).toBe('loaded');
    }
    for (const face of FakeFace.created) {
      expect(sourceOf(face)).toMatch(
        /^url\("\/fonts\/lib\/lora\/400-(normal|italic)-latin(-ext)?\.woff2"\) format\('woff2'\)$/,
      );
    }
  });

  it('loads every weight when none are given, and only the asked ones otherwise', async () => {
    const { loadLibraryFamily } = await loader();
    await loadLibraryFamily('Inter');
    expect(FakeFace.created).toHaveLength(findFamily('Inter')!.files.length);
    FakeFace.created = [];
    await loadLibraryFamily('Roboto', { weights: [700] });
    expect(FakeFace.created.length).toBeGreaterThan(0);
    for (const face of FakeFace.created) expect(face.descriptors.weight).toBe('700');
  });

  it('serves from the given base, without doubling the slash', async () => {
    const { loadLibraryFamily } = await loader();
    await loadLibraryFamily('Great Vibes', { base: 'https://cdn.example.com/f/' });
    expect(FakeFace.created.length).toBeGreaterThan(0);
    for (const face of FakeFace.created)
      expect(sourceOf(face)).toMatch(/^url\("https:\/\/cdn\.example\.com\/f\/great-vibes\//);
  });

  it('registers a face once, however often and however concurrently it is asked for', async () => {
    const { loadLibraryFamily } = await loader();
    const expected = findFamily('Playfair Display')!.files.filter((f) => f.weight === 700).length;
    await Promise.all([
      loadLibraryFamily('Playfair Display', { weights: [700] }),
      loadLibraryFamily('playfair display', { weights: [700] }),
    ]);
    await loadLibraryFamily('Playfair Display', { weights: [700] });
    expect(FakeFace.created).toHaveLength(expected);
  });

  it('points every weight of a variable font at its first copy, so it is downloaded once', async () => {
    const variable = FONT_LIBRARY.find((f) => {
      const a = f.files.find((x) => x.weight === 400 && x.style === 'normal' && x.subset === 'latin');
      const b = f.files.find((x) => x.weight === 700 && x.style === 'normal' && x.subset === 'latin');
      return a && b && a.canonical === b.canonical;
    });
    expect(variable, 'some library family is a variable font with 400 and 700').toBeDefined();
    const { loadLibraryFamily } = await loader();
    await loadLibraryFamily(variable!.family, { weights: [400, 700] });
    const latin = FakeFace.created.filter(
      (f) => f.descriptors.style === 'normal' && !sourceOf(f).includes('-latin-ext'),
    );
    expect(new Set(latin.map(sourceOf)).size).toBe(1);
    expect(latin.map((f) => f.descriptors.weight).sort()).toEqual(['400', '700']);
    expect(sourceOf(latin[0]!)).toContain(`/${variable!.slug}/400-normal-latin.woff2`);
  });

  it('forgets a failed load, leaves nothing registered, and succeeds when asked again', async () => {
    const { loadLibraryFamily } = await loader();
    FakeFace.failLoads = true;
    await expect(loadLibraryFamily('Cardo', { weights: [400] })).rejects.toThrow('network error');
    expect(set.faces.size).toBe(0);
    FakeFace.failLoads = false;
    await loadLibraryFamily('Cardo', { weights: [400] });
    expect(set.faces.size).toBeGreaterThan(0);
    for (const face of set.faces) expect(face.status).toBe('loaded');
  });

  it('does nothing for a family that is not in the library', async () => {
    const { loadLibraryFamily } = await loader();
    await expect(loadLibraryFamily('Comic Sans MS')).resolves.toBeUndefined();
    await expect(loadLibraryFamily('Satoshi')).resolves.toBeUndefined();
    expect(FakeFace.created).toHaveLength(0);
  });

  it('retries a name the engine rejects as CSS with the name quoted, and keeps only that face', async () => {
    FakeFace.strictFamilies = true;
    const { loadLibraryFamily } = await loader();
    await loadLibraryFamily('Source Sans 3', { weights: [400] });
    const files = findFamily('Source Sans 3')!.files.filter((f) => f.weight === 400);
    expect(FakeFace.created).toHaveLength(files.length * 2);
    expect(set.faces.size).toBe(files.length);
    for (const face of set.faces) expect(face.family).toBe('"Source Sans 3"');

    FakeFace.created = [];
    await loadLibraryFamily('Lora', { weights: [400] });
    for (const face of FakeFace.created) expect(face.family).toBe('Lora');
  });

  it('does nothing where there is no FontFaceSet', async () => {
    vi.unstubAllGlobals();
    const { loadLibraryFamily, registerFontData } = await loader();
    await expect(loadLibraryFamily('Lora')).resolves.toBeUndefined();
    await expect(registerFontData('Mine', new ArrayBuffer(8))).resolves.toBeUndefined();
  });
});

describe('registerFontData', () => {
  it('registers an uploaded font under its own name', async () => {
    const { registerFontData } = await loader();
    const data = new ArrayBuffer(2048);
    await registerFontData('Acme Script', data, { weight: '700', style: 'italic' });
    expect(set.faces.size).toBe(1);
    const face = [...set.faces][0]!;
    expect(face.family).toBe('Acme Script');
    expect(face.source).toBe(data);
    expect(face.descriptors).toEqual({ display: 'block', weight: '700', style: 'italic' });
    expect(face.status).toBe('loaded');
  });

  it('registers the same family, descriptors and file once, and anything different separately', async () => {
    const { registerFontData } = await loader();
    const data = new ArrayBuffer(2048);
    await Promise.all([
      registerFontData('Acme', data, { weight: '400' }),
      registerFontData('Acme', data, { weight: '400' }),
    ]);
    await registerFontData('Acme', data, { weight: '400' });
    expect(FakeFace.created).toHaveLength(1);
    await registerFontData('Acme', data, { weight: '700' });
    await registerFontData('Acme', new ArrayBuffer(4096), { weight: '400' });
    await registerFontData('Other', data, { weight: '400' });
    expect(FakeFace.created).toHaveLength(4);
  });

  it('forgets a failure so that registering again can succeed', async () => {
    const { registerFontData } = await loader();
    FakeFace.failLoads = true;
    await expect(registerFontData('Acme', new ArrayBuffer(16))).rejects.toThrow('network error');
    expect(set.faces.size).toBe(0);
    FakeFace.failLoads = false;
    await registerFontData('Acme', new ArrayBuffer(16));
    expect(set.faces.size).toBe(1);
  });
});
