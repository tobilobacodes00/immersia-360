import { z } from 'zod';

/**
 * Help articles are Markdown files with a small block of front matter (HLP-2):
 *
 *     ---
 *     title: Run the setup check
 *     summary: One line that says what the article answers.
 *     category: start
 *     order: 20
 *     keywords: [test, camera, fps]
 *     video: /help/videos/setup-check.mp4
 *     captions: /help/videos/setup-check.en.vtt
 *     ---
 *
 * The parser reads only what the articles need (scalars and inline lists, optionally quoted), so
 * there is no YAML dependency to keep patched. Anything it doesn't understand is an error, not a
 * guess.
 */

export const HELP_CATEGORIES = [
  'start',
  'booth',
  'photo',
  'sharing',
  'live',
  'cloud',
  'design',
  'troubleshooting',
  'account',
  'faq',
] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];

/** Files for videos and captions live under public/help/videos. */
const mediaPath = z.string().regex(/^\/help\/videos\/[\w.-]+$/, 'must be a file under /help/videos/');

export const frontmatterSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    summary: z.string().trim().min(10).max(240),
    category: z.enum(HELP_CATEGORIES),
    /** Position within its category (ascending). */
    order: z.number().int().min(0).max(999),
    /** Extra words people may search with (synonyms, product names). */
    keywords: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    /** Last review, YYYY-MM-DD. */
    updated: z.iso.date(),
    /** Slugs of articles worth reading next. */
    related: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/))
      .max(6)
      .default([]),
    video: mediaPath.optional(),
    /** WebVTT captions for the video: required with it (WCAG 2.2, 1.2.2). */
    captions: mediaPath.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.video && !v.captions) ctx.addIssue({ code: 'custom', path: ['captions'], message: 'a video needs captions' });
    if (v.captions && !v.video) ctx.addIssue({ code: 'custom', path: ['video'], message: 'captions without a video' });
    if (v.video && !/\.(mp4|webm)$/.test(v.video))
      ctx.addIssue({ code: 'custom', path: ['video'], message: 'video must be .mp4 or .webm' });
    if (v.captions && !/\.vtt$/.test(v.captions))
      ctx.addIssue({ code: 'custom', path: ['captions'], message: 'captions must be .vtt' });
  });

export type Frontmatter = z.infer<typeof frontmatterSchema>;

export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrontmatterError';
  }
}

/** Split `---` front matter from the body. */
export function splitFrontmatter(source: string): { raw: string; body: string } {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) throw new FrontmatterError('missing front matter block (--- … ---)');
  return { raw: m[1]!, body: text.slice(m[0].length).replace(/^\n+/, '') };
}

function parseScalar(value: string): string | number {
  const v = value.trim();
  if (v.startsWith('"')) {
    if (!v.endsWith('"') || v.length < 2) throw new FrontmatterError(`unterminated quoted string: ${v}`);
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (v.startsWith("'")) {
    if (!v.endsWith("'") || v.length < 2) throw new FrontmatterError(`unterminated quoted string: ${v}`);
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return /^-?\d+$/.test(v) ? Number(v) : v;
}

function parseList(value: string): (string | number)[] {
  const inner = value.trim().slice(1, -1).trim();
  if (inner === '') return [];
  // Split on commas that are outside quotes.
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  if (quote) throw new FrontmatterError(`unterminated quote in list: ${value}`);
  parts.push(current);
  return parts.map(parseScalar);
}

/** Parse the lines between the `---` fences into a plain object (before validation). */
export function parseFrontmatterBlock(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of raw.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const m = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (!m) throw new FrontmatterError(`cannot read front matter line: ${line}`);
    const [, key, value = ''] = m as unknown as [string, string, string | undefined];
    if (key in out) throw new FrontmatterError(`front matter key repeated: ${key}`);
    out[key] = value.trim().startsWith('[')
      ? value.trim().endsWith(']')
        ? parseList(value)
        : fail(line)
      : parseScalar(value);
  }
  return out;
}

const fail = (line: string): never => {
  throw new FrontmatterError(`unterminated list: ${line}`);
};

/** An article file → validated front matter and Markdown body. */
export function parseArticleSource(source: string): { data: Frontmatter; body: string } {
  const { raw, body } = splitFrontmatter(source);
  const parsed = frontmatterSchema.safeParse(parseFrontmatterBlock(raw));
  if (!parsed.success)
    throw new FrontmatterError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'front matter'}: ${i.message}`).join('; '),
    );
  return { data: parsed.data, body };
}
