/**
 * Builds the render worker into dist/:
 *
 *   dist/page/            what Chrome loads: index.html, render.js (+ chunks) — the booth's render
 *                         engine bundled by esbuild —, h264-encoder.js (the WebAssembly encoder's worker, the
 *                         fallback for a Chrome without an H.264 encoder), mediapipe/ (the person
 *                         segmenter's model and runtime, for backgrounds)
 *   dist/index.mjs        the Node service (everything bundled except Playwright)
 *
 * Nothing is fetched at runtime: the model is downloaded here, once, from the pinned URL (sha256 checked)
 * by the same script the web app uses, and the runtime comes from the @mediapipe/tasks-vision package.
 *
 * `node scripts/bundle.mjs` builds it; scripts/smoke.mjs imports `bundleWorker` and adds its own pages.
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildH264Worker } from '../../../packages/render-engine/scripts/h264-worker.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export const dist = `${root}dist`;

/** The segmenter's files, by the web app's own script (one pin of the model, one place to review it). */
function fetchSegmenter() {
  const run = spawnSync(process.execPath, [`${root}../web/scripts/fetch-segmentation.mjs`], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SEGMENTATION_OUT_DIR: `${dist}/page/mediapipe`,
      SEGMENTATION_CACHE_DIR: `${root}.cache/mediapipe`,
      SEGMENTATION_RESOLVE_FROM: `${root}package.json`,
    },
  });
  if (run.status !== 0) throw new Error('could not prepare the person segmenter (see above)');
}

const browserTarget = { platform: 'browser', format: 'esm', target: 'es2022', bundle: true, logLevel: 'warning' };

export async function bundleWorker() {
  await mkdir(`${dist}/page`, { recursive: true });
  fetchSegmenter();

  await build({
    ...browserTarget,
    entryPoints: { render: `${root}page/entry.ts` },
    outdir: `${dist}/page`,
    // The AAC encoder and the segmenter's runtime are loaded on demand: their own chunks.
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    minify: true,
    legalComments: 'none',
  });
  await copyFile(`${root}page/index.html`, `${dist}/page/index.html`);
  await buildH264Worker(`${dist}/page/h264-encoder.js`);

  await build({
    entryPoints: { index: `${root}src/index.ts` },
    outdir: dist,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // Playwright finds Chrome on disk and ships its own driver: it stays a real dependency.
    external: ['playwright', 'playwright-core'],
    // Bundled CommonJS packages call require(); give them one.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    legalComments: 'none',
    logLevel: 'warning',
  });
  console.log('[render-worker] built dist/page and dist/index.mjs');
}

// Run directly (not imported by the smoke script).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await bundleWorker();
