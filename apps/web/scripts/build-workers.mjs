/**
 * Bundles the app's Web Workers into public/workers/*.js with esbuild.
 *
 * Why not Turbopack's `new Worker(new URL(...))`? Its worker entrypoint reads its bootstrap config
 * from the worker URL's hash, and a worker's location comes from the RESPONSE URL — which carries
 * no fragment when the service worker serves the chunk from its precache. Under our offline
 * service worker that silently breaks every worker. Plain static files have no such dependency,
 * are precached by Serwist like any public asset, and keep booths working offline.
 */
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outdir = `${root}/public/workers`;
await mkdir(outdir, { recursive: true });

const entries = {
  opfs: `${root}/../../packages/offline/src/opfs.worker.ts`,
  render: `${root}/../../packages/render-engine/src/render.worker.ts`,
};

await build({
  entryPoints: entries,
  outdir,
  bundle: true,
  format: 'esm',
  // Lazy imports (the ~1 MB AAC encoder) become their own chunks, fetched only where needed.
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  platform: 'browser',
  target: ['es2022', 'safari16', 'chrome110', 'firefox115'],
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
});

console.log(`[workers] built ${Object.keys(entries).join(', ')} → public/workers`);
