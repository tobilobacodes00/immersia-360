import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Locale } from '@immersia/i18n';
import { HELP_CATEGORIES, parseArticleSource, type Frontmatter, type HelpCategory } from './frontmatter';
import { headings, parseMarkdown, plainText, type Block } from './markdown';
import { buildIndex, type IndexedDoc } from './search';

/**
 * The help articles on disk (HLP-2): `content/help/<locale>/<slug>.md`, one file per article per
 * language. Node only (it reads files), used by the server and by the content tests.
 */

export interface HelpArticle {
  slug: string;
  locale: Locale;
  meta: Frontmatter;
  blocks: Block[];
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** `content/help` in the web app, wherever the process was started from (app folder or repo root). */
export function helpContentDir(): string {
  if (process.env.HELP_CONTENT_DIR) return process.env.HELP_CONTENT_DIR;
  const candidates = [
    path.join(process.cwd(), 'content', 'help'),
    path.join(process.cwd(), 'apps', 'web', 'content', 'help'),
  ];
  return candidates.find((c) => existsSync(c)) ?? candidates[0]!;
}

export async function listSlugs(locale: Locale, dir = helpContentDir()): Promise<string[]> {
  const files = await readdir(path.join(dir, locale)).catch(() => [] as string[]);
  return files
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort();
}

/** One article, parsed. Throws with the file name in the message when the file is malformed. */
export async function loadArticle(locale: Locale, slug: string, dir = helpContentDir()): Promise<HelpArticle> {
  if (!SLUG.test(slug)) throw new Error(`Not a valid article slug: ${slug}`);
  const file = path.join(dir, locale, `${slug}.md`);
  try {
    const { data, body } = parseArticleSource(await readFile(file, 'utf8'));
    return { slug, locale, meta: data, blocks: parseMarkdown(body) };
  } catch (err) {
    throw new Error(`${locale}/${slug}.md: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

const categoryRank = (c: HelpCategory) => HELP_CATEGORIES.indexOf(c);

/** All articles of a language, in reading order: by category, then the order set in each file. */
export async function loadArticles(locale: Locale, dir = helpContentDir()): Promise<HelpArticle[]> {
  const articles = await Promise.all((await listSlugs(locale, dir)).map((slug) => loadArticle(locale, slug, dir)));
  return articles.sort(
    (a, b) =>
      categoryRank(a.meta.category) - categoryRank(b.meta.category) ||
      a.meta.order - b.meta.order ||
      a.meta.title.localeCompare(b.meta.title, locale),
  );
}

export function searchIndex(articles: readonly HelpArticle[]): IndexedDoc[] {
  return buildIndex(
    articles.map((a) => ({
      slug: a.slug,
      title: a.meta.title,
      summary: a.meta.summary,
      category: a.meta.category,
      order: a.meta.order,
      keywords: a.meta.keywords,
      headings: headings(a.blocks).map((h) => h.text),
      body: plainText(a.blocks),
    })),
  );
}
