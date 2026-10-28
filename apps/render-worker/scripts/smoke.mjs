/**
 * The render worker's smoke test, for CI: builds the worker (the same bundle that ships), adds the smoke
 * page and runner next to it, and runs them against Chrome. See src/smoke.ts for what it checks.
 *
 *   pnpm --filter @immersia/render-worker smoke
 *
 * Chrome stable must be installed (`channel: 'chrome'`; the CI runner image has it), or CHROME_PATH set.
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundleWorker, dist } from './bundle.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

await bundleWorker();

await mkdir(`${dist}/smoke`, { recursive: true });
await build({
  entryPoints: { smoke: `${root}page/smoke-entry.ts` },
  outdir: `${dist}/smoke`,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  logLevel: 'warning',
});
await copyFile(`${root}page/smoke.html`, `${dist}/smoke/index.html`);

await build({
  entryPoints: { 'smoke-run': `${root}src/smoke.ts` },
  outdir: dist,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['playwright', 'playwright-core'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});

const run = spawnSync(process.execPath, [`${dist}/smoke-run.mjs`], { stdio: 'inherit', cwd: root });
process.exitCode = run.status ?? 1;
