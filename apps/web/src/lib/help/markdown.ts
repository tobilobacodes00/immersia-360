/**
 * A small Markdown subset for the help centre (HLP-2), parsed to a typed tree that React renders as
 * elements. No HTML is ever produced from the content: text reaches the page only as React text,
 * and a link is kept only when its address is one of a few safe shapes (see `safeHref`). That is
 * the whole security model, so it is deliberately simple.
 *
 * Supported: `##`–`####` headings, paragraphs, **bold**, *italic*, `code`, [links](url), bullet and
 * numbered lists (nested), `> quotes` and `> [!NOTE|TIP|WARNING]` callouts, fenced code blocks,
 * pipe tables, and horizontal rules. Raw HTML is plain text, so `<b>` shows as typed.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] };

export type CalloutKind = 'note' | 'tip' | 'warning';

export type Block =
  | { t: 'heading'; level: 2 | 3 | 4; id: string; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'list'; ordered: boolean; items: Block[][] }
  | { t: 'quote'; kind: CalloutKind | null; c: Block[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' };

// -----------------------------------------------------------------------------------------------
// Links

export type SafeLink =
  | { kind: 'help'; slug: string; anchor: string | null }
  | { kind: 'internal'; href: string }
  | { kind: 'anchor'; href: string }
  | { kind: 'external'; href: string }
  | { kind: 'mailto'; href: string };

const HELP_LINK = /^help:([a-z0-9][a-z0-9-]*)(?:#([a-z0-9][a-z0-9_-]*))?$/;

/** The only addresses a help article may link to; anything else is shown as plain text. */
export function safeHref(href: string): SafeLink | null {
  const h = href.trim();
  const help = HELP_LINK.exec(h);
  if (help) return { kind: 'help', slug: help[1]!, anchor: help[2] ?? null };
  if (/^#[A-Za-z0-9_-]+$/.test(h)) return { kind: 'anchor', href: h };
  // A path on this site: one leading slash, no scheme tricks, no backslashes, no whitespace.
  if (/^\/(?!\/)[^\s\\]*$/.test(h)) return { kind: 'internal', href: h };
  if (/^https?:\/\/[^\s/?#\\]/i.test(h)) {
    try {
      const u = new URL(h);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname && !/\s/.test(h))
        return { kind: 'external', href: u.toString() };
    } catch {
      return null;
    }
  }
  if (/^mailto:[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/i.test(h)) return { kind: 'mailto', href: h };
  return null;
}

// -----------------------------------------------------------------------------------------------
// Inline

const PUNCT = /[\\`*_{}[\]()#+\-.!|>~]/;

function pushText(out: Inline[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last?.t === 'text') last.v += v;
  else out.push({ t: 'text', v });
}

/** Index of the `]` that closes the `[` at `open`, skipping nested brackets and code spans. */
function closingBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') i++;
    else if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end === -1) return -1;
      i = end;
    } else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return i;
  }
  return -1;
}

/** Index of the `)` that closes a link address starting at `from`, counting nested parentheses. */
function closingParen(s: string, from: number): number {
  let depth = 1;
  for (let i = from; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

/** Index of the next unescaped `marker` at or after `from` (outside code spans), or -1. */
function findClose(s: string, marker: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') i++;
    else if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end === -1) return -1;
      i = end;
    } else if (s.startsWith(marker, i)) {
      // `*` closes italic only when it is not the first half of `**`.
      if (marker === '*' && s[i + 1] === '*') {
        i++;
        continue;
      }
      // `**bold and *italic***`: the closing pair is the last two stars of the run.
      if (marker === '**' && s[i + 2] === '*') return i + 1;
      return i;
    }
  }
  return -1;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '\\' && i + 1 < s.length && PUNCT.test(s[i + 1]!)) {
      pushText(out, s[i + 1]!);
      i += 2;
      continue;
    }
    if (ch === '`') {
      let ticks = 1;
      while (s[i + ticks] === '`') ticks++;
      const fence = '`'.repeat(ticks);
      const end = s.indexOf(fence, i + ticks);
      if (end !== -1) {
        out.push({ t: 'code', v: s.slice(i + ticks, end).replace(/^ (.*) $/, '$1') });
        i = end + ticks;
        continue;
      }
    }
    if (ch === '[') {
      const close = closingBracket(s, i);
      if (close !== -1 && s[close + 1] === '(') {
        const end = closingParen(s, close + 2);
        if (end !== -1) {
          const link = safeHref(s.slice(close + 2, end));
          const inner = parseInline(s.slice(i + 1, close));
          if (link) out.push({ t: 'link', href: s.slice(close + 2, end).trim(), c: inner });
          else out.push(...inner); // an unsafe address: keep the words, drop the link
          i = end + 1;
          continue;
        }
      }
    }
    if (ch === '*' && s[i + 1] === '*') {
      const end = findClose(s, '**', i + 2);
      if (end > i + 2) {
        out.push({ t: 'strong', c: parseInline(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '*' && s[i + 1] !== '*' && s[i + 1] !== ' ') {
      const end = findClose(s, '*', i + 1);
      if (end > i + 1) {
        out.push({ t: 'em', c: parseInline(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '_' && !isWordChar(s[i - 1]) && s[i + 1] !== ' ' && s[i + 1] !== '_') {
      const end = findClose(s, '_', i + 1);
      if (end > i + 1 && !isWordChar(s[end + 1])) {
        out.push({ t: 'em', c: parseInline(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    pushText(out, ch);
    i++;
  }
  return out;
}

export function inlineText(c: readonly Inline[]): string {
  return c.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : inlineText(n.c))).join('');
}

// -----------------------------------------------------------------------------------------------
// Blocks

/** "Chrome — kiosk printing (Windows)" → "chrome-kiosk-printing-windows". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

const EXPLICIT_ID = /\s*\{#([a-z0-9][a-z0-9_-]*)\}\s*$/;
const FENCE = /^(\s*)(`{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const CALLOUT = /^\[!(NOTE|TIP|WARNING)\]\s*$/i;

const indentOf = (line: string) => /^ */.exec(line)![0].length;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else cell += s[i];
  }
  cells.push(cell.trim());
  return cells;
}

const startsBlock = (line: string, next: string | undefined) =>
  FENCE.test(line) ||
  HEADING.test(line) ||
  HR.test(line) ||
  LIST_ITEM.test(line) ||
  /^\s{0,3}>/.test(line) ||
  (line.includes('|') && next !== undefined && TABLE_SEPARATOR.test(next) && next.includes('|'));

export function parseBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const [, , ticks = '```', lang = ''] = fence;
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${ticks}\`*\\s*$`).test(lines[i]!)) body.push(lines[i++]!);
      i++; // the closing fence (a missing one ends the block at the end of the text)
      const strip = Math.min(indentOf(line), ...body.filter((l) => l.trim()).map(indentOf));
      blocks.push({ t: 'code', lang, v: body.map((l) => l.slice(strip)).join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      // A page has one h1 (the article title), so `#` in the body is treated as a section heading.
      const level = Math.max(2, heading[1]!.length) as 2 | 3 | 4;
      // `## Title {#anchor}` fixes the id, so a link into the article survives translation and rewording.
      const explicit = EXPLICIT_ID.exec(heading[2]!);
      const c = parseInline(explicit ? heading[2]!.slice(0, explicit.index) : heading[2]!);
      blocks.push({ t: 'heading', level, id: explicit ? explicit[1]! : slugify(inlineText(c)), c });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }

    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      TABLE_SEPARATOR.test(lines[i + 1]!) &&
      lines[i + 1]!.includes('|')
    ) {
      const head = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && lines[i]!.includes('|'))
        rows.push(splitRow(lines[i++]!).map(parseInline));
      // Ragged rows are padded or trimmed to the header's width.
      blocks.push({
        t: 'table',
        head,
        rows: rows.map((r) => Array.from({ length: head.length }, (_, k) => r[k] ?? [])),
      });
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]!)) inner.push(lines[i++]!.replace(/^\s{0,3}> ?/, ''));
      const marker = CALLOUT.exec(inner[0] ?? '');
      blocks.push({
        t: 'quote',
        kind: marker ? (marker[1]!.toLowerCase() as CalloutKind) : null,
        c: parseBlocks(marker ? inner.slice(1) : inner),
      });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const base = item[1]!.length;
      const ordered = /\d/.test(item[2]!);
      const items: Block[][] = [];
      while (i < lines.length) {
        const first = LIST_ITEM.exec(lines[i]!);
        if (!first || first[1]!.length !== base || /\d/.test(first[2]!) !== ordered) break;
        const offset = base + first[2]!.length + 1;
        const content: string[] = [first[3]!];
        i++;
        while (i < lines.length) {
          const next = lines[i]!;
          if (next.trim() === '') {
            // A blank line stays in the item only when what follows is still indented under it.
            const after = lines.slice(i + 1).find((l) => l.trim() !== '');
            if (after !== undefined && indentOf(after) > base) {
              content.push('');
              i++;
              continue;
            }
            break;
          }
          if (indentOf(next) <= base) break;
          content.push(next.slice(Math.min(indentOf(next), offset)));
          i++;
        }
        while (content[content.length - 1] === '') content.pop();
        items.push(parseBlocks(content));
        // A blank line between items keeps the list going.
        let j = i;
        while (j < lines.length && lines[j]!.trim() === '') j++;
        const resumes = j < lines.length && LIST_ITEM.exec(lines[j]!);
        if (resumes && resumes[1]!.length === base && /\d/.test(resumes[2]!) === ordered) i = j;
      }
      blocks.push({ t: 'list', ordered, items });
      continue;
    }

    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && lines[i]!.trim() !== '' && !startsBlock(lines[i]!, lines[i + 1]))
      para.push(lines[i++]!.trim());
    blocks.push({ t: 'p', c: parseInline(para.join(' ')) });
  }
  return blocks;
}

/** Make heading ids unique within a document ("setup", "setup-2", …). */
function uniqueIds(blocks: Block[], seen = new Map<string, number>()): Block[] {
  return blocks.map((b) => {
    if (b.t === 'heading') {
      const base = b.id || 'section';
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { ...b, id: n === 1 ? base : `${base}-${n}` };
    }
    if (b.t === 'quote') return { ...b, c: uniqueIds(b.c, seen) };
    if (b.t === 'list') return { ...b, items: b.items.map((it) => uniqueIds(it, seen)) };
    return b;
  });
}

export function parseMarkdown(source: string): Block[] {
  return uniqueIds(parseBlocks(source.replace(/\r\n?/g, '\n').split('\n')));
}

// -----------------------------------------------------------------------------------------------
// Reading the tree

export function blockText(b: Block): string {
  switch (b.t) {
    case 'heading':
    case 'p':
      return inlineText(b.c);
    case 'list':
      return b.items.map((it) => it.map(blockText).join(' ')).join(' ');
    case 'quote':
      return b.c.map(blockText).join(' ');
    case 'code':
      return b.v;
    case 'table':
      return [...b.head, ...b.rows.flat()].map(inlineText).join(' ');
    case 'hr':
      return '';
  }
}

/** All the words of a document, for search. */
export const plainText = (blocks: readonly Block[]) => blocks.map(blockText).filter(Boolean).join('\n');

/** The h2 and h3 headings, for the table of contents and search. */
export function headings(blocks: readonly Block[]): { level: 2 | 3; id: string; text: string }[] {
  const out: { level: 2 | 3; id: string; text: string }[] = [];
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      if (b.t === 'heading' && b.level <= 3) out.push({ level: b.level as 2 | 3, id: b.id, text: inlineText(b.c) });
      else if (b.t === 'quote') walk(b.c);
      else if (b.t === 'list') b.items.forEach(walk);
    }
  };
  walk(blocks);
  return out;
}

/** Every link address in a document, for the content tests. */
export function links(blocks: readonly Block[]): string[] {
  const out: string[] = [];
  const inline = (c: readonly Inline[]) => {
    for (const n of c) {
      if (n.t === 'link') {
        out.push(n.href);
        inline(n.c);
      } else if (n.t === 'strong' || n.t === 'em') inline(n.c);
    }
  };
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      if (b.t === 'heading' || b.t === 'p') inline(b.c);
      else if (b.t === 'quote') walk(b.c);
      else if (b.t === 'list') b.items.forEach(walk);
      else if (b.t === 'table') [...b.head, ...b.rows.flat()].forEach(inline);
    }
  };
  walk(blocks);
  return out;
}
