import type { CatalogueFamily } from './catalogue';
// Pinned by scripts/generate.mjs: every file's URL on Google's static host, sha256, size, copyright.
// Build tooling and tests read this; browsers get the slim view in runtime.json (see library.ts).
import data from './library.json';

export type FontSubset = 'latin' | 'latin-ext';
export type FontStyle = 'normal' | 'italic';

export interface ManifestFile {
  weight: number;
  style: FontStyle;
  subset: FontSubset;
  /** The subset's unicode-range, as Google serves it: the browser only fetches a file for text it covers. */
  unicodeRange: string;
  /** Path under the library root (/fonts/lib): `<slug>/<weight>-<style>-<subset>.woff2`. */
  file: string;
  /** Where the build downloads it from (a versioned fonts.gstatic.com URL). */
  source: string;
  sha256: string;
  bytes: number;
}

export interface ManifestFamily extends CatalogueFamily {
  /** The font's own copyright line (name table ID 0), kept for attribution. */
  copyright: string;
  files: ManifestFile[];
}

// The JSON is checked against the catalogue by the unit tests; TypeScript only sees plain strings in it.
export const FONT_MANIFEST: readonly ManifestFamily[] = data as ManifestFamily[];
