import { CATALOGUE, type FontCategory } from './catalogue';
import { findFamily } from './library';

/**
 * Loading fonts for canvas text. The layout renderer draws with `ctx.font = "<weight> <size>px
 * <stack>"`, and canvas never waits for a font: text is drawn in whatever is loaded right now. So
 * every face is fetched eagerly (`face.load()`, which also ignores unicode-range) before rendering.
 *
 * Browser and worker only; with no FontFaceSet (SSR, tests) the loaders do nothing.
 */

/** Where the build puts the library (apps/web/scripts/fetch-font-library.mjs). */
export const FONT_LIBRARY_BASE = '/fonts/lib';

const FALLBACKS: Record<FontCategory, string> = {
  sans: 'system-ui, sans-serif',
  serif: 'Georgia, serif',
  display: 'sans-serif',
  handwriting: 'cursive',
  mono: 'ui-monospace, monospace',
};

let categories: Map<string, FontCategory> | undefined;

const cssString = (value: string) => `"${value.replace(/[\\"]/g, '\\$&').replace(/[\r\n\f]/g, ' ')}"`;

/** A CSS `font-family` list for a family: the quoted name, then generic fallbacks that suit its category. */
export function fontStack(family: string): string {
  categories ??= new Map(CATALOGUE.map((c) => [c.family.toLowerCase(), c.category]));
  const category = categories.get(family.trim().toLowerCase());
  return `${cssString(family)}, ${category ? FALLBACKS[category] : 'sans-serif'}`;
}

function fontSet(): FontFaceSet | null {
  const scope = globalThis as typeof globalThis & { fonts?: FontFaceSet };
  return (typeof document !== 'undefined' ? document.fonts : undefined) ?? scope.fonts ?? null;
}

/**
 * Add a face to the set and load it. Chrome and Safari take the family as a plain name (a quoted one
 * would be registered with the quotes in it, and never match). An engine that parses it as a CSS
 * family name instead rejects a bare number ("Source Sans 3", "Press Start 2P") with a SyntaxError and
 * wants it quoted, so that one failure is retried quoted. Other failures leave nothing in the set.
 */
async function addFace(set: FontFaceSet, family: string, make: (family: string) => FontFace): Promise<void> {
  const attempt = async (name: string) => {
    const face = make(name);
    set.add(face);
    try {
      await face.load();
    } catch (err) {
      set.delete(face);
      throw err;
    }
  };
  try {
    await attempt(family);
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'SyntaxError')) throw err;
    await attempt(cssString(family));
  }
}

/** Faces already loaded or loading, by key, so a font is registered and fetched once per page or worker. */
const requests = new Map<string, Promise<void>>();

function once(key: string, start: () => Promise<void>): Promise<void> {
  const existing = requests.get(key);
  if (existing) return existing;
  const request = start().catch((err: unknown) => {
    // Forget failures so that a later call (back online, after a deploy) can try again.
    requests.delete(key);
    throw err;
  });
  requests.set(key, request);
  return request;
}

export interface LoadOptions {
  /** Only these weights (default: every weight the library has for the family). */
  weights?: number[];
  /** Where the library is served from (default `/fonts/lib`). */
  base?: string;
}

/**
 * Register a library family's faces and wait until they are loaded. Resolves without doing anything
 * for a family that is not in the library, so a missing font degrades to its fallback stack.
 * Rejects if a file cannot be fetched; calling again retries only what failed.
 */
export async function loadLibraryFamily(family: string, opts: LoadOptions = {}): Promise<void> {
  const entry = findFamily(family);
  const set = fontSet();
  if (!entry || !set || typeof FontFace === 'undefined') return;
  const base = (opts.base ?? FONT_LIBRARY_BASE).replace(/\/+$/, '');
  const files = entry.files.filter((f) => !opts.weights || opts.weights.includes(f.weight));
  await Promise.all(
    files.map((file) =>
      once(`${base}|${file.file}`, () =>
        addFace(
          set,
          entry.family,
          (name) =>
            // Variable fonts: every weight loads the same canonical file, so the browser fetches it once.
            new FontFace(name, `url(${cssString(`${base}/${file.canonical}`)}) format('woff2')`, {
              weight: String(file.weight),
              style: file.style,
              unicodeRange: file.unicodeRange,
              display: 'block',
            }),
        ),
      ),
    ),
  );
}

/**
 * Register a font the operator uploaded (any family name; `fontStack` gives it a generic fallback).
 * `data` is the raw font file. The same family, descriptors and file size register once.
 */
export async function registerFontData(
  family: string,
  data: ArrayBuffer,
  descriptors: FontFaceDescriptors = {},
): Promise<void> {
  const set = fontSet();
  if (!set || typeof FontFace === 'undefined') return;
  // The size is in the key so that re-uploading a different file under the same name is not mistaken
  // for the one already loaded.
  const own = Object.entries(descriptors).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const key = `data|${family}|${data.byteLength}|${JSON.stringify(own)}`;
  await once(key, () => addFace(set, family, (name) => new FontFace(name, data, { display: 'block', ...descriptors })));
}
