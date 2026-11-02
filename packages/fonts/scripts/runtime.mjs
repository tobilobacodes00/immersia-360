// Derives src/runtime.json, the slim view of the font library that ships to browsers, from
// src/library.json (the build manifest with source URLs, hashes and copyright lines, ~300 KB).
// Browsers only need, per family: its faces, their subset and which file holds their bytes.
// generate.mjs runs this after writing library.json; it can also be run on its own.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * @param {Array<{ family: string, slug: string, category: string, weights: number[], italic: boolean, licence: string,
 *   files: Array<{ weight: number, style: string, subset: string, unicodeRange: string, sha256: string }> }>} library
 */
export function deriveRuntime(library) {
  /** @type {Record<string, string>} */
  const ranges = {};
  const families = library.map((f) => ({
    family: f.family,
    slug: f.slug,
    category: f.category,
    weights: f.weights,
    italic: f.italic,
    licence: f.licence,
    files: f.files.map((x) => {
      if (ranges[x.subset] !== undefined && ranges[x.subset] !== x.unicodeRange)
        throw new Error(`${f.family}: ${x.subset} has a different unicode-range than other families`);
      ranges[x.subset] = x.unicodeRange;
      // A variable font is one file for every weight: point at the first copy of the same bytes.
      const canonical = f.files.findIndex((y) => y.sha256 === x.sha256);
      return [x.weight, x.style, x.subset, canonical];
    }),
  }));
  return { ranges, families };
}

export async function writeRuntime() {
  const library = JSON.parse(await readFile(join(SRC, 'library.json'), 'utf8'));
  await writeFile(join(SRC, 'runtime.json'), `${JSON.stringify(deriveRuntime(library))}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await writeRuntime();
