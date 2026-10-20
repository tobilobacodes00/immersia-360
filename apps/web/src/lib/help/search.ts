/**
 * Help-centre search (HLP-2): words in the title, summary, headings, keywords and body, ranked, with
 * prefix matching ("kios" finds "kiosk") and tolerance for a slip of the keys ("pritner"). Pure and
 * small enough to ship to the browser, so results appear as the person types and keep working on a
 * flaky venue connection once the page has loaded.
 *
 * Text is folded before matching: lower case, accents removed ("cámara" matches "camara"), anything
 * that isn't a letter or digit is a word break.
 */

export interface SearchDoc {
  slug: string;
  title: string;
  summary: string;
  category: string;
  order: number;
  keywords: readonly string[];
  headings: readonly string[];
  body: string;
}

/** What goes to the browser: each field as a string of folded, de-duplicated words. */
export interface IndexedDoc {
  slug: string;
  title: string;
  summary: string;
  category: string;
  order: number;
  /** Folded title (whole, for the phrase bonus). */
  phrase: string;
  words: Record<Field, string>;
}

type Field = 'title' | 'keywords' | 'headings' | 'summary' | 'body';

const WEIGHT: Record<Field, number> = { title: 10, keywords: 8, headings: 5, summary: 4, body: 1 };
const FIELDS = Object.keys(WEIGHT) as Field[];

/** Lower case, accents off, everything else a space. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const tokens = (s: string): string[] => {
  const f = fold(s);
  return f ? f.split(' ') : [];
};

const unique = (list: string[]) => [...new Set(list)];

export function buildIndex(docs: readonly SearchDoc[]): IndexedDoc[] {
  return docs.map((d) => ({
    slug: d.slug,
    title: d.title,
    summary: d.summary,
    category: d.category,
    order: d.order,
    phrase: fold(d.title),
    words: {
      title: unique(tokens(d.title)).join(' '),
      keywords: unique(d.keywords.flatMap(tokens)).join(' '),
      headings: unique(d.headings.flatMap(tokens)).join(' '),
      summary: unique(tokens(d.summary)).join(' '),
      body: unique(tokens(d.body)).join(' '),
    },
  }));
}

/** Edit distance with adjacent swaps counted as one slip, giving up past `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push(Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  }
  for (let i = 1; i <= a.length; i++) {
    // Any alignment crosses every row, so a row whose cheapest cell is already over budget ends it.
    let best = rows[i]![0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = d;
      best = Math.min(best, d);
    }
    if (best > max) return max + 1;
  }
  return rows[a.length]![b.length]!;
}

/** How well one query word matches one indexed word: 1 exact, 0.8 starts with, 0.5 a slip away, else 0. */
export function wordMatch(query: string, word: string): number {
  if (word === query) return 1;
  if (word.startsWith(query)) return 0.8;
  // Typos are only forgiven in words long enough to tell apart; the budget grows with the word.
  if (query.length < 4) return 0;
  const budget = query.length >= 8 ? 2 : 1;
  if (editDistance(query, word, budget) <= budget) return 0.5;
  // As-you-type slips: the query is a mistyped start of the word.
  if (word.length > query.length && editDistance(query, word.slice(0, query.length), budget) <= budget) return 0.4;
  return 0;
}

function fieldScore(query: string, words: string): number {
  if (!words) return 0;
  let best = 0;
  for (const w of words.split(' ')) {
    const m = wordMatch(query, w);
    if (m > best) best = m;
    if (best === 1) break;
  }
  return best;
}

export interface SearchResult {
  doc: IndexedDoc;
  score: number;
}

function scoreDoc(doc: IndexedDoc, query: string[]): { score: number; matched: number } {
  let score = 0;
  let matched = 0;
  for (const q of query) {
    let wordScore = 0;
    for (const f of FIELDS) wordScore += WEIGHT[f] * fieldScore(q, doc.words[f]);
    if (wordScore > 0) matched++;
    score += wordScore;
  }
  return { score, matched };
}

/**
 * Articles that match every word of the query, best first. When nothing matches them all, those that
 * match most of the words are offered instead, ranked lower, so a long question still finds something.
 */
export function search(index: readonly IndexedDoc[], text: string, limit = 12): SearchResult[] {
  const query = unique(tokens(text));
  if (query.length === 0) return [];
  const phrase = fold(text);
  const scored = index.map((doc) => {
    const { score, matched } = scoreDoc(doc, query);
    // The whole query inside the title is the strongest signal there is.
    const bonus = phrase.length >= 3 && doc.phrase.includes(phrase) ? 30 : 0;
    return { doc, score: score + (score > 0 ? bonus : 0), matched };
  });
  const rank = (a: SearchResult, b: SearchResult) =>
    b.score - a.score || a.doc.order - b.doc.order || a.doc.title.localeCompare(b.doc.title);
  const all = scored.filter((s) => s.matched === query.length).sort(rank);
  if (all.length > 0 || query.length === 1) return all.slice(0, limit);
  const most = Math.ceil(query.length / 2);
  return scored
    .filter((s) => s.matched >= most)
    .map((s) => ({ doc: s.doc, score: s.score / 2, matched: s.matched }))
    .sort(rank)
    .slice(0, limit);
}
