import type { CatalogueFamily } from './catalogue';
import type { FontStyle, FontSubset } from './manifest';
// The browser view of the library (scripts/runtime.mjs): faces and subsets, ~27 KB instead of the
// ~300 KB build manifest with its URLs, hashes and copyright lines.
import data from './runtime.json';

export type { FontStyle, FontSubset };

export interface FontFile {
  weight: number;
  style: FontStyle;
  subset: FontSubset;
  /** The subset's unicode-range, as Google serves it. */
  unicodeRange: string;
  /** Path under the library root (/fonts/lib): `<slug>/<weight>-<style>-<subset>.woff2`. */
  file: string;
  /**
   * The file holding these bytes. Variable fonts are one file for every weight, saved once per
   * weight; loading every weight from the first copy means the browser fetches it once.
   */
  canonical: string;
}

export interface LibraryFamily extends CatalogueFamily {
  files: FontFile[];
}

interface RuntimeData {
  ranges: Record<FontSubset, string>;
  families: (CatalogueFamily & { files: [number, FontStyle, FontSubset, number][] })[];
}

const runtime = data as RuntimeData;
const path = (slug: string, weight: number, style: FontStyle, subset: FontSubset) =>
  `${slug}/${weight}-${style}-${subset}.woff2`;

export const FONT_LIBRARY: readonly LibraryFamily[] = runtime.families.map((f) => {
  const files = f.files.map(([weight, style, subset]) => ({
    weight,
    style,
    subset,
    unicodeRange: runtime.ranges[subset],
    file: path(f.slug, weight, style, subset),
  }));
  return {
    ...f,
    files: files.map((x, i) => ({ ...x, canonical: files[f.files[i]![3]]!.file })),
  };
});

let byName: Map<string, LibraryFamily> | undefined;

/** The library entry for a family name (case-insensitive), or undefined for anything not in the library. */
export function findFamily(family: string): LibraryFamily | undefined {
  byName ??= new Map(FONT_LIBRARY.map((f) => [f.family.toLowerCase(), f]));
  return byName.get(family.trim().toLowerCase());
}
