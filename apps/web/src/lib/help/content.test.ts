import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES, type Locale } from '@immersia/i18n';
import { HELP_ARTICLES } from '../help-links';
import { helpContentDir, listSlugs, loadArticles, searchIndex, type HelpArticle } from './content';
import { parseArticleSource } from './frontmatter';
import { search } from './search';
import { headings, links, safeHref, blockText, type Block } from './markdown';

/**
 * The shipped help articles (HLP-2), checked as content: every language has the same articles with the
 * same structure, every link points somewhere real, nothing in a body can become markup, and search finds
 * the obvious things in every language.
 */

const MIN_ARTICLES = 20;

const library = new Map<Locale, HelpArticle[]>();
const bySlug = new Map<Locale, Map<string, HelpArticle>>();
for (const locale of LOCALES) {
  const articles = await loadArticles(locale);
  library.set(locale, articles);
  bySlug.set(locale, new Map(articles.map((a) => [a.slug, a])));
}
const en = bySlug.get('en')!;

/** The shape of a body: headings by level and id, and how many of each other block it has. */
function shape(blocks: readonly Block[]) {
  const counts: Record<string, number> = {};
  const ids: string[] = [];
  const code: string[] = [];
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      counts[b.t] = (counts[b.t] ?? 0) + 1;
      if (b.t === 'heading') ids.push(`${b.level}:${b.id}`);
      if (b.t === 'code') code.push(b.v);
      if (b.t === 'quote') walk(b.c);
      if (b.t === 'list') b.items.forEach(walk);
    }
  };
  walk(blocks);
  return { counts, ids, code };
}

const headingIds = (a: HelpArticle) => headings(a.blocks).map((h) => h.id);

describe('help content: the same articles in every language (HLP-2)', () => {
  it('has at least 20 articles in each language', () => {
    for (const locale of LOCALES) expect(library.get(locale)!.length, locale).toBeGreaterThanOrEqual(MIN_ARTICLES);
  });

  it.each(LOCALES.filter((l) => l !== 'en'))('%s has exactly the English slugs', async (locale) => {
    expect(await listSlugs(locale)).toEqual(await listSlugs('en'));
  });

  it.each(LOCALES.filter((l) => l !== 'en'))("%s keeps each article's category, order and related links", (locale) => {
    for (const [slug, a] of en) {
      const t = bySlug.get(locale)!.get(slug)!;
      expect(t.meta.category, `${locale}/${slug} category`).toBe(a.meta.category);
      expect(t.meta.order, `${locale}/${slug} order`).toBe(a.meta.order);
      expect(t.meta.related, `${locale}/${slug} related`).toEqual(a.meta.related);
      expect(Boolean(t.meta.video), `${locale}/${slug} video`).toBe(Boolean(a.meta.video));
    }
  });

  it.each(LOCALES.filter((l) => l !== 'en'))(
    '%s follows the English structure: headings, tables, code and links',
    (locale) => {
      for (const [slug, a] of en) {
        const t = bySlug.get(locale)!.get(slug)!;
        const want = shape(a.blocks);
        const got = shape(t.blocks);
        expect(got.counts, `${locale}/${slug} block counts`).toEqual(want.counts);
        // Heading ids come from the words of the heading unless fixed with {#id}, so only the fixed ones
        // (the deep links the app uses) must match; the level sequence must match as well.
        expect(
          got.ids.map((i) => i.split(':')[0]),
          `${locale}/${slug} heading levels`,
        ).toEqual(want.ids.map((i) => i.split(':')[0]));
        expect(got.code, `${locale}/${slug} code blocks are commands: they stay as they are`).toEqual(want.code);
        expect(links(t.blocks).sort(), `${locale}/${slug} links`).toEqual(links(a.blocks).sort());
      }
    },
  );

  it('every article is real: a title, a summary and a body of substance', () => {
    for (const locale of LOCALES)
      for (const a of library.get(locale)!) {
        const words = a.blocks.map(blockText).join(' ').split(/\s+/).filter(Boolean).length;
        expect(words, `${locale}/${a.slug}`).toBeGreaterThanOrEqual(a.meta.category === 'faq' ? 50 : 150);
        expect(a.meta.title.length, `${locale}/${a.slug} title`).toBeGreaterThan(8);
      }
  });

  it('no article in any language leaves a template placeholder or a competitor name behind', () => {
    for (const locale of LOCALES)
      for (const a of library.get(locale)!) {
        const text = [a.meta.title, a.meta.summary, ...a.blocks.map(blockText)].join('\n');
        expect(text, `${locale}/${a.slug}`).not.toMatch(/lorem ipsum|boothlab|photoboothsoftware/i);
        // Markers a writer leaves for themselves (upper case, so Spanish and Portuguese "todo" is fine).
        expect(text, `${locale}/${a.slug}`).not.toMatch(/\b(TODO|TBD|FIXME|XXX)\b/);
      }
  });
});

describe('help content: links go somewhere real', () => {
  it('every help: link names an article that exists, and an anchor that exists in it', () => {
    for (const locale of LOCALES) {
      const all = bySlug.get(locale)!;
      for (const a of all.values())
        for (const href of [...links(a.blocks), ...a.meta.related.map((r) => `help:${r}`)]) {
          const link = safeHref(href);
          expect(link, `${locale}/${a.slug}: ${href}`).not.toBeNull();
          if (link?.kind !== 'help') continue;
          const target = all.get(link.slug);
          expect(target, `${locale}/${a.slug} links to missing article ${link.slug}`).toBeDefined();
          if (link.anchor)
            expect(headingIds(target!), `${locale}/${a.slug} links to missing anchor #${link.anchor}`).toContain(
              link.anchor,
            );
        }
    }
  });

  it('no link is written that the renderer would drop: every "](address)" in a file is a safe one', () => {
    for (const locale of LOCALES)
      for (const a of library.get(locale)!) {
        const file = path.join(helpContentDir(), locale, `${a.slug}.md`);
        const source = parseArticleSource(readFileSync(file, 'utf8')).body;
        const prose = source.replace(/```[\s\S]*?```/g, '');
        const written = [...prose.matchAll(/\]\(([^)]*)\)/g)].map((m) => m[1]!);
        for (const href of written) expect(safeHref(href), `${locale}/${a.slug}: ${href}`).not.toBeNull();
        expect(written.length, `${locale}/${a.slug}`).toBe(links(a.blocks).length);
      }
  });

  it('every article the app links to from its own screens exists in every language', () => {
    for (const locale of LOCALES)
      for (const slug of Object.values(HELP_ARTICLES))
        expect(bySlug.get(locale)!.has(slug), `${locale}/${slug}`).toBe(true);
  });

  it('the error articles carry an anchor for every code the app can show', () => {
    const connect = [
      'denied',
      'state',
      'scope',
      'no_refresh',
      'exchange',
      'unreachable',
      'unavailable',
      'forbidden',
      'failed',
    ];
    const copy = [
      'reauth_required',
      'quota_exceeded',
      'transient',
      'folder_missing',
      'folder_inaccessible',
      'source_gone',
      'other',
    ];
    const camera = ['permission', 'not_found', 'in_use', 'overconstrained', 'insecure', 'lost'];
    // The messages the booth shows itself, and why a render failed, are explained in one article.
    const booth = [
      'lost',
      'recording_unsupported',
      'unknown',
      'undecodable',
      'unsupported_encoder',
      'encoder_stall',
      'gpu',
      'cancelled',
      'failed',
    ];
    for (const locale of LOCALES) {
      const all = bySlug.get(locale)!;
      const ids = (slug: string) => headingIds(all.get(slug)!);
      for (const code of [...connect, ...copy])
        expect(ids('cloud-copy-errors'), `${locale} cloud ${code}`).toContain(code);
      for (const code of camera) expect(ids('camera-permissions'), `${locale} camera ${code}`).toContain(code);
      for (const code of booth) expect(ids('booth-error-messages'), `${locale} booth ${code}`).toContain(code);
    }
  });
});

describe('help content: nothing in a body can become markup', () => {
  it('has no HTML tags, scripts or inline handlers outside code', () => {
    const walk = (blocks: readonly Block[], where: string) => {
      for (const b of blocks) {
        if (b.t === 'code') continue;
        const text = blockText(b);
        expect(text, where).not.toMatch(/<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i);
        expect(text, where).not.toMatch(/javascript:|on\w+\s*=/i);
      }
    };
    for (const locale of LOCALES) for (const a of library.get(locale)!) walk(a.blocks, `${locale}/${a.slug}`);
  });

  it('keeps videos and captions together, in the right place', () => {
    const root = path.join(helpContentDir(), '..', '..', 'public');
    for (const locale of LOCALES)
      for (const a of library.get(locale)!) {
        if (!a.meta.video) continue;
        expect(a.meta.captions, `${locale}/${a.slug}`).toBeDefined();
        expect(existsSync(path.join(root, a.meta.video)), `${a.meta.video} exists`).toBe(true);
        expect(existsSync(path.join(root, a.meta.captions!)), `${a.meta.captions} exists`).toBe(true);
        // Captions are in the reader's language.
        expect(a.meta.captions, `${locale}/${a.slug} captions language`).toContain(`.${locale}.`);
      }
  });
});

describe('help content: search finds the obvious things in every language', () => {
  const cases: Record<Locale, [query: string, slug: string][]> = {
    en: [
      ['kiosk printing', 'chrome-kiosk-printing'],
      ['camera blocked', 'camera-permissions'],
      ['google drive', 'connect-google-drive'],
      ['guided access', 'kiosk-locking'],
      ['slow motion', 'slow-motion-tips'],
      ['2x6', 'printing-setup'],
      ['qr lost', 'faq-guest-lost-qr'],
      ['opt out', 'live-display-moderation'],
      ['safari storage', 'ios-storage-eviction'],
      ['pritner', 'printing-setup'],
    ],
    es: [
      ['impresión de quiosco', 'chrome-kiosk-printing'],
      ['camara bloqueada', 'camera-permissions'],
      ['google drive', 'connect-google-drive'],
      ['acceso guiado', 'kiosk-locking'],
      ['cámara lenta', 'slow-motion-tips'],
      ['codigo qr perdido', 'faq-guest-lost-qr'],
      ['sin conexión', 'offline-mode-and-uploads'],
    ],
    pt: [
      ['impressão de quiosque', 'chrome-kiosk-printing'],
      ['camera bloqueada', 'camera-permissions'],
      ['google drive', 'connect-google-drive'],
      ['acesso guiado', 'kiosk-locking'],
      ['câmera lenta', 'slow-motion-tips'],
      ['codigo qr perdido', 'faq-guest-lost-qr'],
      ['offline', 'offline-mode-and-uploads'],
    ],
  };
  for (const locale of LOCALES)
    it(`${locale}: each query finds its article in the top three`, () => {
      const index = searchIndex(library.get(locale)!);
      for (const [query, slug] of cases[locale]) {
        const found = search(index, query).map((r) => r.doc.slug);
        expect(found.slice(0, 3), `${locale}: "${query}"`).toContain(slug);
      }
    });
});
