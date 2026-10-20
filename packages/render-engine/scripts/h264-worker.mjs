/**
 * Builds `h264-encoder.js`, the classic worker script of the WASM H.264 encoder (the `wasm` rung of
 * the render ladder): the `h264-mp4-encoder` web bundle (it defines the global `HME`) followed by
 * our glue (src/wasm/h264-glue.js). Both the web app's worker build and the render worker's page
 * build call this, so the file is served from the app's own origin: nothing is fetched from a CDN
 * at runtime, and the service worker precaches it with the other workers for offline booths.
 *
 * The bundle carries its WebAssembly inline (base64), so this one file is everything.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** The worker script as text. */
export async function h264WorkerSource() {
  const web = await readFile(require.resolve('h264-mp4-encoder/embuild/dist/h264-mp4-encoder.web.js'), 'utf8');
  const glue = await readFile(fileURLToPath(new URL('../src/wasm/h264-glue.js', import.meta.url)), 'utf8');
  // The bundle points at a source map that is not served.
  return `${web.replace(/\/\/# sourceMappingURL=.*$/m, '')}\n;\n${glue}`;
}

export async function buildH264Worker(outfile) {
  await mkdir(dirname(outfile), { recursive: true });
  await writeFile(outfile, await h264WorkerSource());
}
