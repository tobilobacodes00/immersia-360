// Puts the on-device segmentation runtime (CAP-10, background replacement) in public/mediapipe/ before a dev
// server or build, so booths load it from their own origin and no frame ever goes to a server.
//
//   * the MediaPipe Tasks Vision WebAssembly files are part of the pinned @mediapipe/tasks-vision package
//     (Apache-2.0): copied from node_modules, not downloaded;
//   * the selfie segmentation model (selfie_segmenter.tflite, float16, 256×256; Apache-2.0) is not committed:
//     it is downloaded from Google's model bucket, from a pinned URL, and checked against the recorded size
//     and sha256. It is cached by hash in .next/cache/mediapipe (Vercel and CI keep .next/cache between
//     builds), so a warm run makes no request.
//
// Idempotent: files already in place are left alone. Licences: apps/web/src/LICENSES-THIRD-PARTY.md.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '..', 'public', 'mediapipe');
const CACHE_DIR = join(here, '..', '.next', 'cache', 'mediapipe');

// `/float16/1/` is the immutable copy of `/float16/latest/`; the hash below is what is actually trusted.
const MODEL = {
  file: 'selfie_segmenter.tflite',
  source:
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
  bytes: 249_537,
  sha256: '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b',
};

// The classic and no-SIMD runtimes serve the main thread; the ES-module one serves module Web Workers.
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
];
const MARKER = '.tasks-vision-version';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sizeOf = async (path) => (await stat(path).catch(() => null))?.size ?? null;

/** Write via a temp file so an interrupted run never leaves a truncated file behind. */
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

/** GET with a 30 s deadline (covering the body) and 3 tries; client errors other than 408/429 are final. */
async function fetchBytes(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1000 * i));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = new Error(`${res.status} ${res.statusText}`);
      if (res.status < 500 && res.status !== 408 && res.status !== 429) break;
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

async function copyRuntime() {
  // The package exports its wasm files by name, not its package.json: resolve one, then walk up.
  const wasmDir = dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision/vision_wasm_internal.js'));
  const { version } = JSON.parse(await readFile(join(wasmDir, '..', 'package.json'), 'utf8'));
  const sources = await Promise.all(WASM_FILES.map(async (name) => [name, await sizeOf(join(wasmDir, name))]));
  const missing = sources.filter(([, size]) => size === null).map(([name]) => name);
  if (missing.length) throw new Error(`@mediapipe/tasks-vision ${version} does not contain ${missing.join(', ')}`);

  const marker = await readFile(join(OUT_DIR, MARKER), 'utf8').catch(() => '');
  const sameSizes = (
    await Promise.all(sources.map(async ([name, size]) => (await sizeOf(join(OUT_DIR, name))) === size))
  ).every(Boolean);
  if (marker === version && sameSizes) return 0;

  for (const [name] of sources) {
    const tmp = join(OUT_DIR, `${name}.${process.pid}.tmp`);
    try {
      await copyFile(join(wasmDir, name), tmp);
      await rename(tmp, join(OUT_DIR, name));
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }
  await writeFile(join(OUT_DIR, MARKER), version);
  return sources.length;
}

async function fetchModel() {
  const target = join(OUT_DIR, MODEL.file);
  const matches = (buf) => buf.length === MODEL.bytes && sha256(buf) === MODEL.sha256;
  if ((await sizeOf(target)) === MODEL.bytes && matches(await readFile(target))) return 'present';
  const cached = join(CACHE_DIR, `${MODEL.sha256}.tflite`);
  let buf = await readFile(cached).catch(() => null);
  let how = 'cache';
  if (!buf || !matches(buf)) {
    how = 'download';
    buf = await fetchBytes(MODEL.source);
    if (!matches(buf))
      throw new Error(
        `got ${buf.length} bytes with sha256 ${sha256(buf)}, expected ${MODEL.bytes} bytes with ${MODEL.sha256}. ` +
          'The file at this URL changed: review the new model (and its licence), then update the pin in this script.',
      );
    await mkdir(CACHE_DIR, { recursive: true });
    // The cache only saves time, so failing to fill it (read-only disk) must not fail the build.
    await writeAtomic(cached, buf).catch(() => undefined);
  }
  await writeAtomic(target, buf);
  return how;
}

try {
  await mkdir(OUT_DIR, { recursive: true });
  const copied = await copyRuntime();
  const model = await fetchModel();
  if (copied || model !== 'present')
    console.log(
      `[segmentation] runtime ${copied ? `copied (${copied} files)` : 'up to date'}, model ${model} → public/mediapipe`,
    );
} catch (err) {
  console.error(
    `[segmentation] Could not prepare background replacement: ${err instanceof Error ? err.message : err}\n` +
      `The model comes from ${MODEL.source} and the runtime from the @mediapipe/tasks-vision package (run pnpm install).`,
  );
  // Not process.exit(): straight after network use that can trip a libuv assertion on Windows.
  process.exitCode = 1;
}
