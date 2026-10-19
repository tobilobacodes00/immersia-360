// Fetches the PHO-9 font library (100+ open-licence families, SIL OFL 1.1 or Apache 2.0) before a dev
// server or build, into public/fonts/lib/ (gitignored), so the app serves every font from its own
// origin and booths never call Google at runtime.
//
// packages/fonts/src/library.json pins each file by its exact fonts.gstatic.com URL, size and sha256
// (written by `pnpm --filter @immersia/fonts generate`), so a build only ever gets the bytes that were
// reviewed. Files come from the cache in .next/cache/font-library (Vercel keeps .next/cache between
// builds, and CI caches it) or else from the pinned URL, are verified, and are cached by sha256.
// Idempotent: a file already in place at its recorded size is left alone, so a warm run is a few stats.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(here, '..', '..', '..', 'packages', 'fonts', 'src', 'library.json');
const LIBRARY_DIR = join(here, '..', 'public', 'fonts', 'lib');
const CACHE_DIR = join(here, '..', '.next', 'cache', 'font-library');
const CONCURRENCY = 8;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function hasSize(path, bytes) {
  try {
    return (await stat(path)).size === bytes;
  } catch {
    return false;
  }
}

/** Write via a temp file so an interrupted run never leaves a truncated font behind. */
async function writeAtomic(path, buf) {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, buf);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

async function fromCache({ sha256: expected, bytes }) {
  try {
    const buf = await readFile(join(CACHE_DIR, `${expected}.woff2`));
    return buf.length === bytes && sha256(buf) === expected ? buf : null;
  } catch {
    return null;
  }
}

/** GET with a 20 s deadline (covering the body) and 3 tries; client errors other than 408/429 are final. */
async function fetchBytes(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1000 * i));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = new Error(`${res.status} ${res.statusText}`);
      if (res.status < 500 && res.status !== 408 && res.status !== 429) break;
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

async function download({ source, bytes, sha256: expected }) {
  const buf = await fetchBytes(source);
  const actual = sha256(buf);
  if (buf.length !== bytes || actual !== expected)
    throw new Error(
      `got ${buf.length} bytes with sha256 ${actual}, expected ${bytes} bytes with ${expected}. ` +
        'Google replaced the file at this URL: review the new version, then run `pnpm --filter @immersia/fonts generate`.',
    );
  return buf;
}

async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

let manifest;
try {
  manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
} catch (err) {
  console.error(
    `[fonts] Cannot read the font library manifest ${MANIFEST}: ${err instanceof Error ? err.message : err}`,
  );
  process.exit(1);
}

const files = manifest.flatMap((family) => family.files);
const absent = (
  await Promise.all(files.map(async (f) => ((await hasSize(join(LIBRARY_DIR, f.file), f.bytes)) ? null : f)))
).filter((f) => f !== null);
if (!absent.length) process.exit(0);

// Variable fonts are one file for several weights; fetch each distinct file once and copy it to every path.
const wanted = new Map();
for (const f of absent) {
  const entry = wanted.get(f.sha256) ?? { source: f.source, bytes: f.bytes, sha256: f.sha256, targets: [] };
  entry.targets.push(f.file);
  wanted.set(f.sha256, entry);
}

const failures = [];
let downloaded = 0;
let cached = 0;
await pool([...wanted.values()], CONCURRENCY, async (entry) => {
  try {
    let buf = await fromCache(entry);
    if (buf) cached++;
    else {
      buf = await download(entry);
      downloaded++;
      await mkdir(CACHE_DIR, { recursive: true });
      // The cache only saves time, so failing to fill it (read-only disk) must not fail the build.
      await writeAtomic(join(CACHE_DIR, `${entry.sha256}.woff2`), buf).catch(() => undefined);
    }
    for (const target of entry.targets) {
      await mkdir(dirname(join(LIBRARY_DIR, target)), { recursive: true });
      await writeAtomic(join(LIBRARY_DIR, target), buf);
    }
  } catch (err) {
    failures.push(`  ${entry.targets[0]} (${entry.source}): ${err instanceof Error ? err.message : err}`);
  }
});

if (failures.length) {
  console.error(
    `[fonts] Could not fetch ${failures.length} of ${wanted.size} font files for the PHO-9 library:\n${failures.sort().join('\n')}\n` +
      'They come from fonts.gstatic.com (pinned in packages/fonts/src/library.json); check network access and retry.',
  );
  // Not process.exit(): straight after network use that can trip a libuv assertion on Windows.
  process.exitCode = 1;
} else {
  // Forget cached files the manifest no longer lists, so the cache does not grow as the library changes.
  const live = new Set(files.map((f) => `${f.sha256}.woff2`));
  for (const name of await readdir(CACHE_DIR).catch(() => [])) {
    if (/^[0-9a-f]{64}\.woff2$/.test(name) && !live.has(name)) await rm(join(CACHE_DIR, name), { force: true });
  }
  console.log(
    `[fonts] PHO-9 library: ${absent.length} files written (${downloaded} downloaded, ${cached} from cache) → public/fonts/lib`,
  );
}
