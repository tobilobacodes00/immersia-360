import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('service worker: the segmentation runtime cache (CAP-10)', () => {
  const sw = read('./sw.ts');

  it('serves /mediapipe/ cache-first, so the model and wasm work offline after first use', () => {
    expect(sw).toMatch(/url\.pathname\.startsWith\('\/mediapipe\/'\)/);
    expect(sw).toMatch(/handler: new CacheFirst\(/);
  });

  it('is cached under a name that carries the pinned @mediapipe/tasks-vision version', () => {
    // The loader scripts must stay paired with their .wasm: when the pinned version changes, the cache
    // name has to change with it, or a booth would keep the old runtime for a year.
    const pinned = /'@mediapipe\/tasks-vision':\s*([\d.]+)/.exec(read('../../../../pnpm-workspace.yaml'))?.[1];
    const named = /cacheName: 'mediapipe-([\d.]+)'/.exec(sw)?.[1];
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(named).toBe(pinned);
  });

  it('the build copies exactly the files the runtime needs', () => {
    const script = read('../../scripts/fetch-segmentation.mjs');
    for (const file of [
      'vision_wasm_internal.js',
      'vision_wasm_internal.wasm',
      'vision_wasm_nosimd_internal.js',
      'vision_wasm_nosimd_internal.wasm',
      'vision_wasm_module_internal.js',
      'vision_wasm_module_internal.wasm',
      'selfie_segmenter.tflite',
    ])
      expect(script, file).toContain(`'${file}'`);
  });

  it('the model is pinned by size and hash, from the project that publishes it', () => {
    const script = read('../../scripts/fetch-segmentation.mjs');
    expect(script).toMatch(/sha256: '[0-9a-f]{64}'/);
    expect(script).toMatch(/bytes: 249_537/);
    expect(script).toContain('storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/');
  });
});

describe("service worker: the companion app's file URLs (CAP-14)", () => {
  const sw = read('./sw.ts');

  it("leaves Capacitor's file and content URLs to the WebView", () => {
    expect(sw).toContain("'/_capacitor_file_/'");
    expect(sw).toContain("'/_capacitor_content_/'");
    expect(sw).toMatch(/event\.stopImmediatePropagation\(\)/);
  });

  it("is registered before Serwist's own fetch listener, or it would never get the event first", () => {
    const mine = sw.indexOf("self.addEventListener('fetch'");
    const serwist = sw.indexOf('serwist.addEventListeners()');
    expect(mine).toBeGreaterThan(-1);
    expect(serwist).toBeGreaterThan(mine);
  });
});
