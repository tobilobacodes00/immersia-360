import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOCALES, negotiateLocale } from '../src';

type Tree = { [k: string]: string | Tree };
const load = (l: string): Tree =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../messages/${l}.json`, import.meta.url)), 'utf8'));

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

// ICU arguments are {name} or {name, type, …}; plural branch bodies like {plus # GIF} are text.
const placeholders = (s: string) => [...new Set([...s.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]))].sort();

describe('message catalogues (NFR Localisation)', () => {
  const en = flatten(load('en'));

  it.each(LOCALES.filter((l) => l !== 'en'))('%s has exactly the English keys', (locale) => {
    const other = flatten(load(locale));
    expect([...other.keys()].sort()).toEqual([...en.keys()].sort());
  });

  it.each(LOCALES.filter((l) => l !== 'en'))('%s keeps every ICU placeholder', (locale) => {
    const other = flatten(load(locale));
    for (const [key, value] of en) expect(placeholders(other.get(key) ?? ''), key).toEqual(placeholders(value));
  });

  it.each(LOCALES)('%s has no empty strings', (locale) => {
    for (const [key, value] of flatten(load(locale))) expect(value.trim(), key).not.toBe('');
  });
});

describe('negotiateLocale', () => {
  it('honours q-values and region fallbacks', () => {
    expect(negotiateLocale('pt-BR,pt;q=0.9,en;q=0.8')).toBe('pt');
    expect(negotiateLocale('fr-FR,es-419;q=0.7,en;q=0.5')).toBe('es');
    expect(negotiateLocale('en;q=0.2,es;q=0.9')).toBe('es');
    expect(negotiateLocale('de,fr')).toBe('en');
    expect(negotiateLocale(null)).toBe('en');
    expect(negotiateLocale('es;q=0')).toBe('en');
  });
});
