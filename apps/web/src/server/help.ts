import 'server-only';
import type { Locale } from '@immersia/i18n';
import { loadArticles, searchIndex, type HelpArticle } from '@/lib/help/content';
import type { IndexedDoc } from '@/lib/help/search';

/**
 * Help articles for a request (HLP-2). Parsed once per language and kept for the life of the server
 * process in production; in development every request re-reads the files, so an edit shows up on reload.
 */

export interface HelpLibrary {
  articles: HelpArticle[];
  bySlug: Map<string, HelpArticle>;
  index: IndexedDoc[];
}

const cache = new Map<Locale, Promise<HelpLibrary>>();

async function build(locale: Locale): Promise<HelpLibrary> {
  const articles = await loadArticles(locale);
  return { articles, bySlug: new Map(articles.map((a) => [a.slug, a])), index: searchIndex(articles) };
}

export function helpLibrary(locale: Locale): Promise<HelpLibrary> {
  if (process.env.NODE_ENV !== 'production') return build(locale);
  let hit = cache.get(locale);
  if (!hit) {
    hit = build(locale);
    cache.set(locale, hit);
    // A failed read must not be remembered.
    hit.catch(() => cache.delete(locale));
  }
  return hit;
}

/**
 * One article in the reader's language; if a translation is missing (the content tests keep that from
 * shipping) the English one, so a link never dead-ends.
 */
export async function helpArticle(locale: Locale, slug: string): Promise<HelpArticle | null> {
  const own = (await helpLibrary(locale)).bySlug.get(slug);
  if (own || locale === 'en') return own ?? null;
  return (await helpLibrary('en')).bySlug.get(slug) ?? null;
}
