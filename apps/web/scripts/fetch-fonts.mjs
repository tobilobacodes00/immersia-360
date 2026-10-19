// Fetches Satoshi (Indian Type Foundry, via Fontshare) before a dev server or build.
//
// The ITF Free Font License allows embedding Satoshi in a website, which is what the built app does
// (next/font/local self-hosts it from our origin), but not redistributing the font files on their
// own, so they are not committed to this public repository. This script downloads them from the
// licensed source into src/fonts/ (gitignored). It is idempotent: files already present are kept.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'fonts');
const CSS = 'https://api.fontshare.com/v2/css?f[]=satoshi@1,2&display=swap';
const FILES = { normal: 'Satoshi-Variable.woff2', italic: 'Satoshi-VariableItalic.woff2' };

const isWoff2 = (buf) => buf.length > 10_000 && buf.subarray(0, 4).toString('latin1') === 'wOF2';

async function present(name) {
  try {
    return (await stat(join(dir, name))).size > 10_000 && isWoff2(await readFile(join(dir, name)));
  } catch {
    return false;
  }
}

async function fetchWithRetry(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (res.ok) return res;
      last = new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw last;
}

if ((await present(FILES.normal)) && (await present(FILES.italic))) process.exit(0);

try {
  const css = await (await fetchWithRetry(CSS)).text();
  // Two @font-face blocks for Satoshi: style normal, then italic; take each one's woff2 URL.
  const faces = [
    ...css.matchAll(/font-family:\s*'Satoshi';\s*src:\s*url\('([^']+\.woff2)'\)[\s\S]*?font-style:\s*(normal|italic)/g),
  ];
  await mkdir(dir, { recursive: true });
  for (const style of /** @type {const} */ (['normal', 'italic'])) {
    const face = faces.find((f) => f[2] === style);
    if (!face) throw new Error(`Fontshare CSS has no ${style} Satoshi face`);
    const url = face[1].startsWith('//') ? `https:${face[1]}` : face[1];
    const buf = Buffer.from(await (await fetchWithRetry(url)).arrayBuffer());
    if (!isWoff2(buf)) throw new Error(`${url} is not a WOFF2 font`);
    await writeFile(join(dir, FILES[style]), buf);
  }
  console.log('[fonts] Satoshi fetched from Fontshare → src/fonts');
} catch (err) {
  console.error(
    `[fonts] Could not fetch Satoshi from Fontshare (${err instanceof Error ? err.message : err}).\n` +
      'Download it from https://www.fontshare.com/fonts/satoshi and place the two variable WOFF2 files in\n' +
      `apps/web/src/fonts/ as ${FILES.normal} and ${FILES.italic}.`,
  );
  process.exit(1);
}
