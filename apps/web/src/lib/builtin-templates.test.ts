import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, TEMPLATE_CATEGORIES } from '@immersia/layout';
import type { TemplateSummary } from '@/server/templates';
import { SIZE_KEYS, builtinSummaries, filterTemplates, siblingFor, sizeFirst, sizeKeyOf } from './builtin-templates';

const nameOf = (t: TemplateSummary) => t.name;
const none = { category: 'all', size: 'all', query: '' } as const;

const saved = (name: string, printSize: '4x6' | '2x6' = '4x6'): TemplateSummary => ({
  id: `0190f3a0-0000-7000-8000-00000000000${name.length}`,
  kind: 'layout',
  name,
  builtIn: false,
  printSize,
  shots: 3,
  doc: {
    canvas: { width: 1, height: 1, dpi: 300, printSize, background: '#ffffff', backgroundAssetId: null },
    elements: [],
  },
});

describe('built-in template list (PHO-5)', () => {
  it('lists every generated template once, as a read-only built-in with its filters', () => {
    const list = builtinSummaries();
    expect(list).toHaveLength(BUILTIN_TEMPLATES.length);
    for (const t of list) {
      expect(t.builtIn).toBe(true);
      expect(t.id.startsWith('lib:')).toBe(true);
      expect(TEMPLATE_CATEGORIES).toContain(t.category);
      expect(sizeKeyOf(t), t.id).not.toBeNull();
      expect(SIZE_KEYS).toContain(sizeKeyOf(t));
    }
    expect(builtinSummaries('layout').every((t) => t.kind === 'layout' && t.printSize)).toBe(true);
    expect(builtinSummaries('overlay').every((t) => t.kind === 'overlay' && t.aspect)).toBe(true);
    expect(builtinSummaries('layout').length + builtinSummaries('overlay').length).toBe(list.length);
  });

  it('filters by occasion, size and name together', () => {
    const list = [...builtinSummaries(), saved('Gold wedding strip')];
    const wedding = filterTemplates(list, { ...none, category: 'wedding' }, nameOf);
    expect(wedding.length).toBeGreaterThanOrEqual(15);
    expect(wedding.every((t) => t.category === 'wedding')).toBe(true);
    // A saved template has no occasion, so an occasion filter leaves it out.
    expect(wedding.some((t) => !t.builtIn)).toBe(false);

    const sized = filterTemplates(list, { ...none, size: '2x6' }, nameOf);
    expect(sized.every((t) => sizeKeyOf(t) === '2x6')).toBe(true);
    expect(sized.some((t) => !t.builtIn)).toBe(false);

    const both = filterTemplates(list, { ...none, category: 'wedding', size: '4x6' }, nameOf);
    expect(both).toHaveLength(4);
    expect(both.every((t) => t.category === 'wedding' && t.printSize === '4x6')).toBe(true);

    const overlays = filterTemplates(list, { ...none, size: '9:16' }, nameOf);
    expect(overlays.length).toBeGreaterThan(0);
    expect(overlays.every((t) => t.kind === 'overlay')).toBe(true);
  });

  it('searches names word by word, ignoring case and accents', () => {
    const list = [saved('Gold wedding strip'), saved('Boda dorada'), saved('Cumpleaños')];
    expect(filterTemplates(list, { ...none, query: 'GOLD strip' }, nameOf).map((t) => t.name)).toEqual([
      'Gold wedding strip',
    ]);
    expect(filterTemplates(list, { ...none, query: 'cumpleanos' }, nameOf).map((t) => t.name)).toEqual(['Cumpleaños']);
    expect(filterTemplates(list, { ...none, query: '  ' }, nameOf)).toHaveLength(3);
    expect(filterTemplates(list, { ...none, query: 'nothing' }, nameOf)).toHaveLength(0);
  });

  it('finds the same style at another print size, never a copy shrunk with its QR', () => {
    const blush4x6 = builtinSummaries('layout').find((t) => t.style === 'blush' && t.printSize === '4x6')!;
    const strip = siblingFor(blush4x6, { printSize: '2x6' });
    expect(strip).toBeDefined();
    expect(strip).toMatchObject({ style: 'blush', category: 'wedding', printSize: '2x6', builtIn: true });
    expect(siblingFor(blush4x6, { printSize: '4x6' })?.id).toBe(blush4x6.id);
    expect(siblingFor(saved('Mine'), { printSize: '2x6' })).toBeUndefined();

    // Each style has overlays on two of the three aspects.
    const overlay = builtinSummaries('overlay').find((t) => t.style === 'blush')!;
    const aspects = builtinSummaries('overlay')
      .filter((t) => t.style === 'blush')
      .map((t) => t.aspect);
    expect(new Set(aspects).size).toBe(2);
    const missing = (['9:16', '1:1', '16:9'] as const).find((a) => !aspects.includes(a))!;
    expect(siblingFor(overlay, { aspect: missing })).toBeUndefined();
  });

  it('puts templates of the page size first', () => {
    const list = builtinSummaries('layout');
    const first = sizeFirst(list, '4x6');
    expect(first).toHaveLength(list.length);
    const n = list.filter((t) => t.printSize === '4x6').length;
    expect(first.slice(0, n).every((t) => t.printSize === '4x6')).toBe(true);
    expect(first.slice(n).some((t) => t.printSize === '4x6')).toBe(false);
    expect(sizeFirst(list, null)).toEqual(list);
  });
});

describe('page sizes', () => {
  it('lists the six print sizes, then the three video aspects', () => {
    expect(SIZE_KEYS).toEqual(['2x6', '4x4', '4x6', '6x4', '5x7', 'story', '9:16', '1:1', '16:9']);
  });
});
