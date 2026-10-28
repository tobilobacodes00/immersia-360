import { describe, expect, it } from 'vitest';
import { buildIndex, editDistance, fold, search, tokens, wordMatch, type SearchDoc } from './search';

const docs: SearchDoc[] = [
  {
    slug: 'chrome-kiosk-printing',
    title: 'Print without a dialog: Chrome kiosk printing',
    summary: 'Send photo strips straight to the printer with no print window.',
    category: 'photo',
    order: 30,
    keywords: ['silent printing', 'impresión'],
    headings: ['Windows', 'macOS', 'Linux'],
    body: 'Start Chrome with the --kiosk-printing flag. The default printer receives every job at once.',
  },
  {
    slug: 'kiosk-locking',
    title: 'Lock the booth for guests',
    summary: 'Use the exit PIN and the operating system to keep guests in the booth screen.',
    category: 'booth',
    order: 50,
    keywords: ['kiosk mode', 'guided access', 'screen pinning'],
    headings: ['Exit PIN', 'iPad and iPhone', 'Android'],
    body: 'A browser cannot fully lock a device. Guided Access on iOS and screen pinning on Android do the rest.',
  },
  {
    slug: 'camera-permissions',
    title: 'Fix camera permission problems',
    summary: 'The camera is blocked or in use: what to change in Chrome, Safari, Edge and Firefox.',
    category: 'troubleshooting',
    order: 10,
    keywords: ['webcam'],
    headings: ['Chrome', 'Safari'],
    body: 'Allow the camera for this site. Another app may be using the camera.',
  },
  {
    slug: 'camara-es',
    title: 'Permisos de la cámara',
    summary: 'Cómo permitir la cámara en el navegador.',
    category: 'troubleshooting',
    order: 20,
    keywords: [],
    headings: [],
    body: 'Permite la cámara para este sitio.',
  },
];

const index = buildIndex(docs);
const slugs = (q: string) => search(index, q).map((r) => r.doc.slug);

describe('help search: text folding', () => {
  it('lower-cases, drops accents and breaks on punctuation', () => {
    expect(fold('Cámara — Ñandú! (2×6)')).toBe('camara nandu 2 6');
    expect(tokens('  --kiosk-printing  ')).toEqual(['kiosk', 'printing']);
    expect(tokens('')).toEqual([]);
  });
});

describe('help search: matching', () => {
  it('scores exact, prefix and near-miss words', () => {
    expect(wordMatch('kiosk', 'kiosk')).toBe(1);
    expect(wordMatch('kio', 'kiosk')).toBe(0.8);
    expect(wordMatch('kiosc', 'kiosk')).toBe(0.5);
    expect(wordMatch('pritner', 'printer')).toBe(0.5); // two letters swapped
    expect(wordMatch('cat', 'car')).toBe(0); // too short to forgive
    expect(wordMatch('banana', 'kiosk')).toBe(0);
  });

  it('counts a swap as one slip, and gives up past the budget', () => {
    expect(editDistance('abcd', 'abdc', 1)).toBe(1);
    expect(editDistance('kitten', 'sitting', 1)).toBeGreaterThan(1);
    expect(editDistance('a', 'abcdef', 1)).toBeGreaterThan(1);
  });
});

describe('help search: ranking', () => {
  it('finds an article by a word in its title, summary, heading, keywords or body', () => {
    expect(slugs('lock')).toContain('kiosk-locking'); // title
    expect(slugs('straight')).toContain('chrome-kiosk-printing'); // summary
    expect(slugs('macos')).toContain('chrome-kiosk-printing'); // heading
    expect(slugs('guided access')).toEqual(['kiosk-locking']); // keywords
    expect(slugs('receives')).toEqual(['chrome-kiosk-printing']); // body only
  });

  it('matches as the person types: a prefix finds the word', () => {
    expect(slugs('kios')).toEqual(expect.arrayContaining(['chrome-kiosk-printing', 'kiosk-locking']));
    expect(slugs('perm')).toContain('camera-permissions');
  });

  it('forgives a slip of the keys', () => {
    expect(slugs('printr')[0]).toBe('chrome-kiosk-printing');
    expect(slugs('pritner')[0]).toBe('chrome-kiosk-printing');
    expect(slugs('camra')).toEqual(expect.arrayContaining(['camera-permissions']));
  });

  it('ignores accents on either side', () => {
    expect(slugs('camara')).toContain('camara-es');
    expect(slugs('cámara')).toContain('camara-es');
    expect(slugs('impresion')).toContain('chrome-kiosk-printing');
  });

  it('puts title matches above body matches', () => {
    // "camera" is in the title of one article and only the body of the other.
    const r = slugs('camera');
    expect(r[0]).toBe('camera-permissions');
  });

  it('requires every word, and ranks a title that holds the whole phrase first', () => {
    expect(slugs('kiosk printing')[0]).toBe('chrome-kiosk-printing');
    expect(slugs('camera chrome')).toEqual(['camera-permissions']);
  });

  it('offers the best partial matches when no article has every word', () => {
    const r = slugs('kiosk unicorn');
    expect(r.length).toBeGreaterThan(0);
    expect(r).toContain('kiosk-locking');
  });

  it('finds nothing for nonsense and for an empty query', () => {
    expect(slugs('zxqvbn')).toEqual([]);
    expect(slugs('   ')).toEqual([]);
    expect(slugs('')).toEqual([]);
  });

  it('breaks ties by the order set in the article, then by title', () => {
    const tie = buildIndex([
      { ...docs[0]!, slug: 'b', title: 'Same words', order: 2, keywords: [], headings: [], body: '' },
      { ...docs[0]!, slug: 'a', title: 'Same words', order: 1, keywords: [], headings: [], body: '' },
    ]);
    expect(search(tie, 'same words').map((r) => r.doc.slug)).toEqual(['a', 'b']);
  });

  it('respects the limit', () => {
    expect(search(index, 'camera', 1)).toHaveLength(1);
  });
});
