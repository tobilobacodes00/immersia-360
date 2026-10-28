import { ASPECTS, PRINT_SIZES } from '@immersia/shared';
import { BUILTIN_TEMPLATES, type BuiltinTemplate, type TemplateCategory } from '@immersia/layout';
import type { TemplateSummary } from '@/server/templates';

/**
 * The built-in template library (PHO-5) as the studio lists it. Plain data and pure functions, so
 * the server (`listLibraryTemplates`) and the browser (the library screen and the editor's panel)
 * build the same list: the documents are generated from code and identical everywhere, so they never
 * travel over the wire.
 */

/** Built-ins have no database row, so no version to conflict with. */
export const BUILTIN_VERSION = 'built-in';

/** A plain name for logs and fallbacks. The UI names built-ins from their translated parts. */
export const builtinName = (t: Pick<BuiltinTemplate, 'category' | 'style' | 'layoutId'>) =>
  `${t.category} · ${t.style} · ${t.layoutId}`;

function summary(t: BuiltinTemplate): TemplateSummary {
  return {
    id: t.id,
    kind: t.kind,
    name: builtinName(t),
    doc: t.doc,
    builtIn: true,
    category: t.category,
    style: t.style,
    shots: t.shots,
    ...(t.kind === 'layout' ? { printSize: t.printSize } : { aspect: t.aspect }),
  };
}

let all: TemplateSummary[] | undefined;

/** The built-ins for one kind, or all of them, in library order (occasion, style, size). */
export function builtinSummaries(kind?: 'layout' | 'overlay'): TemplateSummary[] {
  all ??= BUILTIN_TEMPLATES.map(summary);
  return kind ? all.filter((t) => t.kind === kind) : all;
}

/** The size a template is made for: a print size (layouts) or a video aspect (overlays). */
export const sizeKeyOf = (t: Pick<TemplateSummary, 'kind' | 'printSize' | 'aspect'>): SizeKey | null =>
  (t.kind === 'layout' ? t.printSize : t.aspect) ?? null;

export type SizeKey = (typeof PRINT_SIZES)[number] | (typeof ASPECTS)[number];

/** Every size a template can be filtered by: the print sizes, then the video aspects. */
export const SIZE_KEYS: readonly SizeKey[] = [...PRINT_SIZES, ...ASPECTS];

export interface TemplateFilters {
  category: TemplateCategory | 'all';
  size: SizeKey | 'all';
  query: string;
}

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Filter by occasion, size and name. A category filter shows built-ins only (a saved template has
 * no occasion); the name filter matches every word, ignoring case and accents. `nameOf` gives the
 * name as the reader sees it, translated.
 */
export function filterTemplates(
  items: readonly TemplateSummary[],
  f: TemplateFilters,
  nameOf: (t: TemplateSummary) => string,
): TemplateSummary[] {
  const words = plain(f.query).split(/\s+/).filter(Boolean);
  return items.filter((t) => {
    if (f.category !== 'all' && t.category !== f.category) return false;
    if (f.size !== 'all' && sizeKeyOf(t) !== f.size) return false;
    if (words.length === 0) return true;
    const name = plain(nameOf(t));
    return words.every((w) => name.includes(w));
  });
}

/**
 * The same built-in style made for another page: a 4×6 wedding strip used for a 2×6 event becomes the
 * 2×6 one from the same style, not a shrunken copy with a QR under 18 mm. Undefined when the template
 * is not a built-in or the style has no version for that size (overlays exist on two aspects).
 */
export function siblingFor(
  t: TemplateSummary,
  target: { printSize?: (typeof PRINT_SIZES)[number]; aspect?: (typeof ASPECTS)[number] },
): TemplateSummary | undefined {
  if (!t.builtIn || !t.category || !t.style) return undefined;
  const want = t.kind === 'layout' ? target.printSize : target.aspect;
  return builtinSummaries(t.kind).find(
    (x) => x.category === t.category && x.style === t.style && sizeKeyOf(x) === want,
  );
}

/** Built-ins whose page is `size` first, the rest after (stable inside each group). */
export function sizeFirst(items: readonly TemplateSummary[], size: SizeKey | null): TemplateSummary[] {
  if (!size) return [...items];
  return [...items.filter((t) => sizeKeyOf(t) === size), ...items.filter((t) => sizeKeyOf(t) !== size)];
}
