// Regenerates src/library.json, the pinned manifest of the PHO-9 font library, from src/catalogue.ts.
//
//   pnpm --filter @immersia/fonts generate [-- --only="Lora,Great Vibes"]
//
// A one-off maintainer tool, not part of any build or test. For every catalogue family it asks the
// Google Fonts CSS API for exactly the catalogue's weights, keeps the latin and latin-ext subsets,
// downloads each woff2 from fonts.gstatic.com, and records its URL, sha256, size and copyright (read
// from the font's own name table). apps/web/scripts/fetch-font-library.mjs later downloads those
// exact URLs and checks those exact hashes, so a build never depends on what Google serves today.
//
// Any family, weight or subset Google does not return, any non-woff2 download, any empty copyright
// and any file whose embedded licence contradicts the catalogue fails the run (exit 1) with a list.
// With --only the run is a dry check of those families and library.json is left alone.
//
// Needs Node 22.18+ (it loads src/catalogue.ts directly through type stripping).
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { writeRuntime } from './runtime.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'library.json');
// A desktop Chrome: Google picks the font format from the User-Agent, and Chrome gets woff2 subsets.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const SUBSETS = ['latin', 'latin-ext'];
const CONCURRENCY = 6;
const log = (msg) => process.stdout.write(`${msg}\n`);

// WOFF2 spec, "known table tags": the table directory refers to common tables by index.
const KNOWN_TAGS = (
  'cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH PCLT ' +
  'VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar ' +
  'fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
)
  .split(' ')
  .map((tag) => tag.replace('_', ' '));

/** A problem to report to the maintainer as it is, without a stack trace. */
class Failure extends Error {}

function fail(lines) {
  throw new Failure(`[fonts] ${lines.join('\n[fonts] ')}`);
}

async function loadCatalogue() {
  try {
    return (await import('../src/catalogue.ts')).CATALOGUE;
  } catch (err) {
    return fail([
      `Could not load src/catalogue.ts (${err instanceof Error ? err.message : err}).`,
      `This script needs Node 22.18 or newer (TypeScript type stripping); you are on ${process.version}.`,
    ]);
  }
}

/** Run `fn` over `items` with a bounded number in flight; results keep the order of `items`. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** GET with a 20 s deadline (covering the body) and 3 tries; client errors other than 408/429 are final. */
async function fetchRetry(url, read) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return await read(res);
      last = new Error(`${res.status} ${res.statusText} for ${url}`);
      if (res.status < 500 && res.status !== 408 && res.status !== 429) break;
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

/**
 * The stylesheet for a css2 query. Now and then Google answers with `/l/font?kit=…` redirector URLs,
 * which serve an HTML page to anything but a browser, instead of the static `/s/…woff2` files we pin;
 * ask again until it answers with the static ones.
 */
async function fetchCss(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const css = await fetchRetry(url, (res) => res.text());
    if (!css.includes('fonts.gstatic.com/l/font?')) return css;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error(`Google kept answering with /l/font redirector URLs instead of static files for ${url}`);
}

/** The css2 query for one family: only the weights (and the 400 italic) the catalogue asks for. */
function cssUrl({ family, weights, italic }) {
  const name = family.replaceAll(' ', '+');
  const axes = italic
    ? `ital,wght@${[...weights.map((w) => `0,${w}`), '1,400'].join(';')}`
    : `wght@${weights.join(';')}`;
  return `https://fonts.googleapis.com/css2?family=${name}:${axes}&display=block`;
}

/** Latin and latin-ext @font-face blocks of a css2 response (the other subsets are ignored). */
function parseFaces(css) {
  const faces = [];
  for (const [, subset, body] of css.matchAll(/\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    if (!SUBSETS.includes(subset)) continue;
    const prop = (name) => body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
    const src = body.match(/src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.woff2)\)\s*format\('woff2'\)/)?.[1];
    faces.push({
      subset,
      family: prop('font-family')?.replace(/^['"]|['"]$/g, ''),
      style: prop('font-style'),
      weight: prop('font-weight'),
      unicodeRange: prop('unicode-range'),
      source: src,
      raw: body.replace(/\s+/g, ' ').trim(),
    });
  }
  return faces;
}

/** Faces for a family, checked against what the catalogue asked for. Throws a message listing every gap. */
function resolveFaces(entry, css) {
  const problems = [];
  const wanted = [...entry.weights.map((w) => [w, 'normal']), ...(entry.italic ? [[400, 'italic']] : [])];
  const found = parseFaces(css);
  const files = [];
  for (const [weight, style] of wanted) {
    for (const subset of SUBSETS) {
      const matches = found.filter((f) => f.subset === subset && f.style === style && f.weight === String(weight));
      if (matches.length > 1) problems.push(`${weight} ${style} ${subset} appears ${matches.length} times`);
      const face = matches[0];
      if (!face) {
        // latin-ext only exists where the font has the glyphs; latin is mandatory.
        if (subset === 'latin') problems.push(`no ${weight} ${style} ${subset} face`);
        continue;
      }
      if (!face.source || !face.unicodeRange)
        problems.push(`${weight} ${style} ${subset} has no gstatic woff2 src or unicode-range: ${face.raw}`);
      if (face.family?.toLowerCase() !== entry.family.toLowerCase()) problems.push(`css family is "${face.family}"`);
      files.push({
        weight,
        style,
        subset,
        unicodeRange: face.unicodeRange,
        file: `${entry.slug}/${weight}-${style}-${subset}.woff2`,
        source: face.source,
      });
    }
  }
  for (const f of found) {
    if (!wanted.some(([w, s]) => String(w) === f.weight && s === f.style))
      problems.push(`unexpected ${f.weight} ${f.style} ${f.subset} face (is the weight a range?)`);
  }
  if (problems.length) throw new Error(problems.join('; '));
  return files;
}

/** Walk a WOFF2 file to its `name` table and return the name strings (nameID -> text). */
function readNames(buf) {
  if (buf.length < 48 || buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  const numTables = buf.readUInt16BE(12);
  const compressedSize = buf.readUInt32BE(20);
  let pos = 48;
  const uintBase128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = buf[pos++];
      if (byte === undefined || (i === 0 && byte === 0x80)) break;
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('bad UIntBase128 in the table directory');
  };
  // The decompressed stream holds the tables back to back, in directory order. A transformed table
  // takes transformLength bytes, not origLength; glyf/loca are transformed at version 0, the rest at
  // versions above 0.
  let offset = 0;
  let name;
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++];
    const version = flags >> 6;
    const index = flags & 0x3f;
    const tag = index === 63 ? buf.toString('latin1', pos, (pos += 4)) : KNOWN_TAGS[index];
    const origLength = uintBase128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    const length = transformed ? uintBase128() : origLength;
    if (tag === 'name') name = { offset, length };
    offset += length;
  }
  if (!name) throw new Error('no name table');
  const table = brotliDecompressSync(buf.subarray(pos, pos + compressedSize)).subarray(
    name.offset,
    name.offset + name.length,
  );

  const count = table.readUInt16BE(2);
  const strings = table.readUInt16BE(4);
  const best = new Map();
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    const platform = table.readUInt16BE(rec);
    const encoding = table.readUInt16BE(rec + 2);
    const language = table.readUInt16BE(rec + 4);
    const id = table.readUInt16BE(rec + 6);
    const length = table.readUInt16BE(rec + 8);
    const start = strings + table.readUInt16BE(rec + 10);
    const raw = table.subarray(start, start + length);
    // Windows Unicode BMP/full, in English first; then Unicode platform; then Mac Roman (ASCII plus ©).
    let text;
    let rank;
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      text = Buffer.from(raw.subarray(0, raw.length & ~1))
        .swap16()
        .toString('utf16le');
      rank = language === 0x409 ? 0 : 1;
    } else if (platform === 0) {
      text = Buffer.from(raw.subarray(0, raw.length & ~1))
        .swap16()
        .toString('utf16le');
      rank = 2;
    } else if (platform === 1 && encoding === 0) {
      text = raw.toString('latin1');
      rank = 3;
    } else continue;
    if (!best.has(id) || best.get(id).rank > rank) best.set(id, { rank, text });
  }
  const clean = (id) => (best.get(id)?.text ?? '').replace(/\s+/g, ' ').trim();
  return { copyright: clean(0), licence: clean(13), licenceUrl: clean(14) };
}

/** Which licence a font's own licence fields name, if they name one we recognise. */
function embeddedLicence({ licence, licenceUrl }) {
  const text = `${licence} ${licenceUrl}`.toLowerCase();
  if (/apache/.test(text)) return 'Apache-2.0';
  if (/ubuntu font licen|\bufl\b/.test(text)) return 'UFL';
  if (/open font licen[cs]e|scripts\.sil\.org\/ofl|openfontlicense\.org|\bofl\b/.test(text)) return 'OFL-1.1';
  return null;
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const STYLE_ORDER = { normal: 0, italic: 1 };

async function main() {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);
  let catalogue = [...(await loadCatalogue())];
  if (only) {
    const names = only.split(',').map((n) => n.trim().toLowerCase());
    catalogue = catalogue.filter((c) => names.includes(c.family.toLowerCase()));
    if (catalogue.length !== names.length) fail([`--only names that are not in the catalogue: ${only}`]);
  }

  const problems = [];
  const note = (family, msg) => problems.push(`${family}: ${msg}`);

  log(`Resolving ${catalogue.length} families on Google Fonts…`);
  const resolved = await pool(catalogue, CONCURRENCY, async (entry) => {
    try {
      return { entry, files: resolveFaces(entry, await fetchCss(cssUrl(entry))) };
    } catch (err) {
      note(entry.family, err instanceof Error ? err.message : String(err));
      return { entry, files: [] };
    }
  });

  // Variable fonts serve one file for several weights; download each URL once.
  const urls = [...new Set(resolved.flatMap((r) => r.files.map((f) => f.source)))];
  log(`Downloading ${urls.length} distinct font files…`);
  const downloads = new Map();
  await pool(urls, CONCURRENCY, async (url) => {
    try {
      const buf = await fetchRetry(url, async (res) => Buffer.from(await res.arrayBuffer()));
      if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 font (missing wOF2 magic)');
      downloads.set(url, {
        sha256: createHash('sha256').update(buf).digest('hex'),
        bytes: buf.length,
        ...readNames(buf),
      });
    } catch (err) {
      problems.push(`${url}: ${err instanceof Error ? err.message : err}`);
    }
  });

  const library = [];
  const unverifiedLicence = [];
  for (const { entry, files } of resolved) {
    if (!files.length) continue;
    const full = files
      .map((f) => ({ ...f, ...downloads.get(f.source) }))
      .filter((f) => f.sha256)
      .sort((a, b) => a.weight - b.weight || STYLE_ORDER[a.style] - STYLE_ORDER[b.style] || byText(a.subset, b.subset));
    if (full.length !== files.length) continue; // a download failed; already reported
    for (const f of full) {
      if (!f.copyright) note(entry.family, `${f.file} has an empty copyright (name ID 0)`);
      const declared = embeddedLicence(f);
      if (declared && declared !== entry.licence)
        note(entry.family, `${f.file} says ${declared} but the catalogue says ${entry.licence}`);
      if (!declared && !unverifiedLicence.includes(entry.family)) unverifiedLicence.push(entry.family);
    }
    library.push({
      family: entry.family,
      slug: entry.slug,
      category: entry.category,
      weights: entry.weights,
      italic: entry.italic,
      licence: entry.licence,
      copyright: full[0].copyright,
      files: full.map(({ weight, style, subset, unicodeRange, file, source, sha256, bytes }) => ({
        weight,
        style,
        subset,
        unicodeRange,
        file,
        source,
        sha256,
        bytes,
      })),
    });
  }

  if (problems.length)
    fail([`${problems.length} problem(s), library.json not written:`, ...problems.sort().map((p) => `  ${p}`)]);

  library.sort((a, b) => byText(a.family, b.family));
  const allFiles = library.flatMap((f) => f.files);
  const distinct = new Map(allFiles.map((f) => [f.sha256, f.bytes]));
  const sum = (xs) => xs.reduce((n, x) => n + x, 0);
  const noExt = library.filter((f) => !f.files.some((x) => x.subset === 'latin-ext')).map((f) => f.family);
  log(
    `${library.length} families, ${allFiles.length} files (${distinct.size} distinct), ` +
      `${sum(allFiles.map((f) => f.bytes))} bytes as deployed, ${sum([...distinct.values()])} bytes distinct.`,
  );
  log(`No latin-ext subset on Google Fonts: ${noExt.join(', ') || 'none'}.`);
  if (unverifiedLicence.length)
    log(
      `No recognisable licence in the font files, trusting the catalogue for: ${unverifiedLicence.sort().join(', ')}.`,
    );

  if (only) {
    log('Dry run (--only): library.json left unchanged.');
    return;
  }
  await writeFile(OUT, `${JSON.stringify(library, null, 2)}\n`);
  log(`Wrote ${OUT}`);
  await writeRuntime();
  log('Wrote the browser view, src/runtime.json');
}

// Set the exit code rather than calling process.exit(): after network use that can trip a libuv assertion on Windows.
main().catch((err) => {
  process.stderr.write(`${err instanceof Failure ? err.message : (err?.stack ?? err)}\n`);
  process.exitCode = 1;
});
