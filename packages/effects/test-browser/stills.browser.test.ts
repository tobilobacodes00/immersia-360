import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LOOKS,
  PHOTO_EFFECTS,
  ShaderCompileError,
  StillRunner,
  findLook,
  findPhotoEffect,
  type PhotoEffectDef,
} from '../src/index';
import { PATTERN_H, PATTERN_W, drawTestPattern, readPixels } from './pattern';

/**
 * Every look and photo effect (the stills pack), compiled and run for real (WebGL2 on SwiftShader in CI) through the
 * StillRunner on a synthetic 256x192 test pattern, plus the runner's own behaviour.
 */

let runner: StillRunner;
let pattern: OffscreenCanvas;
let input: Uint8ClampedArray;

beforeAll(() => {
  runner = new StillRunner();
  pattern = drawTestPattern();
  input = readPixels(pattern);
});

afterAll(() => runner.dispose());

/** Mean and max absolute difference over the colour channels. */
function diff(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  expect(a.length).toBe(b.length);
  let sum = 0;
  let max = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4)
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c]! - b[i + c]!);
      sum += d;
      if (d > max) max = d;
      n++;
    }
  return { mean: sum / n, max };
}

/** The largest spread between the channels of any pixel (0 = every pixel is a pure grey). */
function maxChroma(px: Uint8ClampedArray): number {
  let max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const hi = Math.max(px[i]!, px[i + 1]!, px[i + 2]!);
    const lo = Math.min(px[i]!, px[i + 1]!, px[i + 2]!);
    if (hi - lo > max) max = hi - lo;
  }
  return max;
}

/** Opaque and not degenerate: a NaN or a broken shader shows up as transparent, black or flat output. */
function expectSane(px: Uint8ClampedArray, label: string) {
  let lo = 255;
  let hi = 0;
  let transparent = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] !== 255) transparent++;
    for (let c = 0; c < 3; c++) {
      const v = px[i + c]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  expect(transparent, `${label}: pixels that are not opaque`).toBe(0);
  expect(hi, `${label}: output is entirely black`).toBeGreaterThan(40);
  expect(hi - lo, `${label}: output is flat`).toBeGreaterThan(40);
}

function sizeOf(canvas: OffscreenCanvas | HTMLCanvasElement): [number, number] {
  return [canvas.width, canvas.height];
}

describe('looks', () => {
  it.each(LOOKS.map((l) => l.id))('%s compiles, is sane, deterministic and exact at intensity 0', (id) => {
    const look = findLook(id)!;
    const full = readPixels(runner.render(pattern, { look, lookIntensity: 1 }));
    expectSane(full, id);
    expect(diff(readPixels(runner.render(pattern, { look, lookIntensity: 1 })), full).max, `${id} repeat`).toBe(0);
    expect(
      diff(readPixels(runner.render(pattern, { look, lookIntensity: 0 })), input).max,
      `${id} at 0`,
    ).toBeLessThanOrEqual(2);
  });

  it.each(LOOKS.filter((l) => l.id !== 'none').map((l) => l.id))('%s changes the picture at intensity 1', (id) => {
    const out = readPixels(runner.render(pattern, { look: findLook(id)!, lookIntensity: 1 }));
    expect(diff(out, input).mean).toBeGreaterThan(2);
  });

  it('none is the identity', () => {
    const out = readPixels(runner.render(pattern, { look: findLook('none')!, lookIntensity: 1 }));
    expect(diff(out, input).max).toBeLessThanOrEqual(2);
  });

  it('mono and noir are fully desaturated', () => {
    for (const id of ['mono', 'noir']) {
      const out = readPixels(runner.render(pattern, { look: findLook(id)!, lookIntensity: 1 }));
      expect(maxChroma(out), id).toBeLessThanOrEqual(2);
    }
  });

  it('noir is moodier than mono: deeper shadows, and mono keeps the black and white points', () => {
    // The grey ramp runs black to white over x 0..127 at y 64..127; sample its quarter point and the extremes.
    const ramp = (id: string, x: number) =>
      readPixels(runner.render(pattern, { look: findLook(id)!, lookIntensity: 1 }))[(96 * PATTERN_W + x) * 4]!;
    expect(ramp('noir', 32)).toBeLessThan(ramp('mono', 32) - 5);
    expect(ramp('mono', 124)).toBeGreaterThan(235);
    expect(ramp('mono', 2)).toBeLessThan(20);
  });

  it('scales smoothly with the intensity: half strength lies between none and full', () => {
    const look = findLook('vivid')!;
    const half = diff(readPixels(runner.render(pattern, { look, lookIntensity: 0.5 })), input).mean;
    const full = diff(readPixels(runner.render(pattern, { look, lookIntensity: 1 })), input).mean;
    expect(half).toBeGreaterThan(full * 0.35);
    expect(half).toBeLessThan(full * 0.65);
  });

  it('animates the grain with the time and the seed, and nothing else', () => {
    const film = findLook('film')!;
    const at = (time: number, seed = 0) => readPixels(runner.render(pattern, { look: film, time, seed }));
    expect(diff(at(0), at(0)).max).toBe(0);
    expect(diff(at(1), at(1)).max).toBe(0);
    expect(diff(at(0), at(1)).mean).toBeGreaterThan(0.2);
    expect(diff(at(0, 0), at(0, 3)).mean).toBeGreaterThan(0.2);
    const mono = findLook('mono')!; // no grain: time and seed do not matter
    const plain = (time: number, seed: number) => readPixels(runner.render(pattern, { look: mono, time, seed }));
    expect(diff(plain(0, 0), plain(5, 9)).max).toBe(0);
  });

  it('keeps the grain strength steady from 720 px up (the grain grows with the picture) and softer below', () => {
    const film = findLook('film')!;
    const grainOnly = { ...film, params: { ...film.params, vignette: 0 } };
    const flat = new OffscreenCanvas(1440, 1440);
    const ctx = flat.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 1440, 1440);
    const noise = (size: number) => {
      const px = readPixels(runner.render(flat, { look: grainOnly, width: size, height: size }));
      let sum = 0;
      let sumSq = 0;
      const n = px.length / 4;
      for (let i = 0; i < px.length; i += 4) {
        sum += px[i]!;
        sumSq += px[i]! ** 2;
      }
      return Math.sqrt(sumSq / n - (sum / n) ** 2);
    };
    const at720 = noise(720);
    expect(at720).toBeGreaterThan(2);
    expect(noise(1440)).toBeGreaterThan(at720 * 0.7);
    expect(noise(1440)).toBeLessThan(at720 * 1.3);
    expect(noise(256)).toBeLessThan(at720);
  });
});

describe('photo effects', () => {
  it.each(PHOTO_EFFECTS.map((e) => e.id))('%s compiles, is sane, deterministic and exact at intensity 0', (id) => {
    const effect = findPhotoEffect(id)!;
    const full = readPixels(runner.render(pattern, { effect, effectIntensity: 1 }));
    expectSane(full, id);
    expect(diff(readPixels(runner.render(pattern, { effect, effectIntensity: 1 })), full).max, `${id} repeat`).toBe(0);
    expect(
      diff(readPixels(runner.render(pattern, { effect, effectIntensity: 0 })), input).max,
      `${id} at 0`,
    ).toBeLessThanOrEqual(2);
  });

  it.each(PHOTO_EFFECTS.filter((e) => e.id !== 'none').map((e) => e.id))(
    '%s changes the picture at intensity 1',
    (id) => {
      const out = readPixels(runner.render(pattern, { effect: findPhotoEffect(id)!, effectIntensity: 1 }));
      expect(diff(out, input).mean).toBeGreaterThan(2);
    },
  );

  it('none is the identity', () => {
    const out = readPixels(runner.render(pattern, { effect: findPhotoEffect('none')!, effectIntensity: 1 }));
    expect(diff(out, input).max).toBeLessThanOrEqual(2);
  });

  it('mirror reflects the left half onto the right: the result is left-right symmetric', () => {
    const out = readPixels(runner.render(pattern, { effect: findPhotoEffect('mirror')!, effectIntensity: 1 }));
    let worst = 0;
    for (let y = 0; y < PATTERN_H; y++)
      for (let x = 0; x < PATTERN_W / 2; x++)
        for (let c = 0; c < 3; c++) {
          const a = out[(y * PATTERN_W + x) * 4 + c]!;
          const b = out[(y * PATTERN_W + (PATTERN_W - 1 - x)) * 4 + c]!;
          worst = Math.max(worst, Math.abs(a - b));
        }
    expect(worst).toBeLessThanOrEqual(1);
    // ...and the left half itself is untouched.
    let leftWorst = 0;
    for (let y = 0; y < PATTERN_H; y++)
      for (let x = 0; x < PATTERN_W / 2 - 1; x++)
        for (let c = 0; c < 3; c++)
          leftWorst = Math.max(
            leftWorst,
            Math.abs(out[(y * PATTERN_W + x) * 4 + c]! - input[(y * PATTERN_W + x) * 4 + c]!),
          );
    expect(leftWorst).toBeLessThanOrEqual(2);
  });

  it('thermal is a heat map: dark areas are cold (blue-ish), bright areas hot (red/yellow)', () => {
    const out = readPixels(runner.render(pattern, { effect: findPhotoEffect('thermal')!, effectIntensity: 1 }));
    const px = (x: number, y: number) => {
      const i = (y * PATTERN_W + x) * 4;
      return [out[i]!, out[i + 1]!, out[i + 2]!] as const;
    };
    const [dr, , db] = px(8, 96); // the left end of the grey ramp (black)
    const [hr, hg] = px(120, 96); // the right end of the grey ramp (white)
    expect(db).toBeGreaterThan(dr);
    expect(hr).toBeGreaterThan(200);
    expect(hg).toBeGreaterThan(150);
  });

  it('is resolution independent: the same picture at 4x the size has the same overall tones', async () => {
    const big = drawTestPattern(PATTERN_W * 4, PATTERN_H * 4);
    const mean = (px: Uint8ClampedArray) => {
      let s = 0;
      for (let i = 0; i < px.length; i += 4) s += px[i]! + px[i + 1]! + px[i + 2]!;
      return s / ((px.length / 4) * 3);
    };
    // The outline effects detect edges one pixel wide (an edge cannot be thinner than a pixel), so a
    // small render has relatively heavier lines than a large one: compared separately, with room.
    const outlines = new Set(['sketch', 'comic', 'neon-edges']);
    for (const effect of PHOTO_EFFECTS) {
      if (effect.id === 'none') continue;
      const small = mean(readPixels(runner.render(pattern, { effect, effectIntensity: 1 })));
      // The runner reuses its canvas, so copy the large render out before averaging it back down 4x.
      const large = await createImageBitmap(runner.render(big, { effect, effectIntensity: 1 }));
      const scaled = mean(readPixels(runner.render(large, { width: PATTERN_W, height: PATTERN_H })));
      large.close();
      // Fine texture (halftone dots, glass jitter) cannot match pixel for pixel; the overall tones must.
      expect(Math.abs(small - scaled), effect.id).toBeLessThan(outlines.has(effect.id) ? 40 : 14);
    }
  });
});

describe('the runner', () => {
  it('renders upright: with nothing to apply the output is the input', () => {
    const out = readPixels(runner.render(pattern));
    expect(diff(out, input).max).toBeLessThanOrEqual(2);
  });

  it('mirror flips horizontally (the selfie preview)', () => {
    const out = readPixels(runner.render(pattern, { mirror: true }));
    const flipped = new Uint8ClampedArray(input.length);
    for (let y = 0; y < PATTERN_H; y++)
      for (let x = 0; x < PATTERN_W; x++)
        for (let c = 0; c < 4; c++)
          flipped[(y * PATTERN_W + x) * 4 + c] = input[(y * PATTERN_W + (PATTERN_W - 1 - x)) * 4 + c]!;
    expect(diff(out, flipped).max).toBeLessThanOrEqual(2);
  });

  it('applies the effect first and the look second', () => {
    // Thermal paints a colour heat map; mono afterwards must turn all of it grey. Look-first would
    // leave the false colours in place.
    const both = readPixels(runner.render(pattern, { effect: findPhotoEffect('thermal')!, look: findLook('mono')! }));
    expect(maxChroma(both)).toBeLessThanOrEqual(2);
    const effectOnly = readPixels(runner.render(pattern, { effect: findPhotoEffect('thermal')! }));
    expect(maxChroma(effectOnly)).toBeGreaterThan(100);
  });

  it("defaults the effect intensity to the effect's defaultIntensity", () => {
    const effect = findPhotoEffect('bulge')!;
    expect(effect.defaultIntensity).toBeLessThan(1);
    const implicit = readPixels(runner.render(pattern, { effect }));
    const explicit = readPixels(runner.render(pattern, { effect, effectIntensity: effect.defaultIntensity }));
    expect(diff(implicit, explicit).max).toBe(0);
  });

  it('sizes the output: explicit size, one side derived from the source aspect, default the source size', () => {
    expect(sizeOf(runner.render(pattern))).toEqual([PATTERN_W, PATTERN_H]);
    expect(sizeOf(runner.render(pattern, { width: 128 }))).toEqual([128, 96]);
    expect(sizeOf(runner.render(pattern, { height: 384 }))).toEqual([512, 384]);
    expect(sizeOf(runner.render(pattern, { width: 100, height: 100 }))).toEqual([100, 100]);
  });

  it('cover-crops to a different aspect instead of stretching', () => {
    // A square output of the 256x192 pattern shows the centre 192x192: the first and last 32 px columns are cut.
    const out = readPixels(runner.render(pattern, { width: 192, height: 192 }));
    const at = (px: Uint8ClampedArray, w: number, x: number, y: number) => {
      const i = (y * w + x) * 4;
      return [px[i]!, px[i + 1]!, px[i + 2]!];
    };
    for (const [ox, oy] of [
      [10, 10],
      [100, 150],
      [180, 30],
    ] as const) {
      const got = at(out, 192, ox, oy);
      const want = at(input, PATTERN_W, ox + 32, oy);
      for (let c = 0; c < 3; c++) expect(Math.abs(got[c]! - want[c]!)).toBeLessThanOrEqual(2);
    }
  });

  it('downscales large sources without aliasing (mipmaps): a 1px checker averages to grey', () => {
    const size = 1024;
    const c = new OffscreenCanvas(size, size);
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = (x + y) % 2 === 0 ? 255 : 0;
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    const out = readPixels(runner.render(c, { width: 64, height: 64 }));
    let worst = 0;
    for (let i = 0; i < out.length; i += 4) worst = Math.max(worst, Math.abs(out[i]! - 128));
    expect(worst).toBeLessThanOrEqual(12);
  });

  it('accepts an ImageBitmap and an ImageData as well as canvases', async () => {
    const bitmap = await createImageBitmap(pattern);
    expect(diff(readPixels(runner.render(bitmap)), input).max).toBeLessThanOrEqual(2);
    const data = pattern.getContext('2d')!.getImageData(0, 0, PATTERN_W, PATTERN_H);
    expect(diff(readPixels(runner.render(data)), input).max).toBeLessThanOrEqual(2);
    bitmap.close();
  });

  it('rejects a source without size and an output beyond the GPU limit', () => {
    expect(() => runner.render(new OffscreenCanvas(0, 0))).toThrow(RangeError);
    expect(() => runner.render(pattern, { width: 1e6, height: 10 })).toThrow(RangeError);
    // ...and still works afterwards.
    expect(diff(readPixels(runner.render(pattern)), input).max).toBeLessThanOrEqual(2);
  });

  it('reuses its canvas between renders (stable allocations)', () => {
    const a = runner.render(pattern, { look: findLook('film')! });
    const b = runner.render(pattern, { look: findLook('mono')!, effect: findPhotoEffect('swirl')! });
    expect(b).toBe(a);
  });

  it('toBlob encodes the result and toImageBitmap copies it', async () => {
    const blob = await runner.toBlob(pattern, { look: findLook('sepia')!, width: 128, height: 96 });
    expect(blob.type).toBe('image/png');
    const decoded = await createImageBitmap(blob);
    expect([decoded.width, decoded.height]).toEqual([128, 96]);
    decoded.close();
    const jpeg = await runner.toBlob(pattern, { type: 'image/jpeg', quality: 0.8 });
    expect(jpeg.type).toBe('image/jpeg');

    const bitmap = await runner.toImageBitmap(pattern, { look: findLook('mono')! });
    expect([bitmap.width, bitmap.height]).toEqual([PATTERN_W, PATTERN_H]);
    // The copy is independent: rendering something else does not change it.
    runner.render(pattern, { effect: findPhotoEffect('swirl')! });
    const c = new OffscreenCanvas(PATTERN_W, PATTERN_H);
    c.getContext('2d')!.drawImage(bitmap, 0, 0);
    expect(maxChroma(readPixels(c))).toBeLessThanOrEqual(2);
    bitmap.close();
  });

  it('reports a shader that does not compile with its id, and keeps working', () => {
    const broken: PhotoEffectDef = {
      id: 'broken-fx',
      name: 'Broken',
      defaultIntensity: 1,
      frag: '#version 300 es\nprecision highp float;\nin vec2 vUv;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(notDeclared); }\n',
    };
    let error: unknown;
    try {
      runner.render(pattern, { effect: broken });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ShaderCompileError);
    expect((error as ShaderCompileError).shaderId).toBe('broken-fx');
    expect((error as ShaderCompileError).stage).toBe('fragment');
    expect((error as ShaderCompileError).message).toContain('broken-fx');
    expect((error as ShaderCompileError).log).toContain('notDeclared');
    // The failure is remembered (no recompile every frame) and does not poison other renders.
    expect(() => runner.warm([broken])).toThrow(ShaderCompileError);
    expect(
      diff(readPixels(runner.render(pattern, { effect: findPhotoEffect('pixelate')! })), input).mean,
    ).toBeGreaterThan(2);
  });

  it('warm compiles ahead without rendering', () => {
    const fresh = new StillRunner();
    try {
      expect(() => fresh.warm([...LOOKS.slice(0, 3), ...PHOTO_EFFECTS.slice(0, 3), null])).not.toThrow();
    } finally {
      fresh.dispose();
    }
  });

  it('recovers from a lost WebGL context on the next render', () => {
    const own = new StillRunner();
    try {
      const look = findLook('golden-hour')!;
      const effect = findPhotoEffect('halftone')!;
      const before = readPixels(own.render(pattern, { look, effect }));
      const canvas = own.render(pattern, { look, effect });
      const gl = canvas instanceof HTMLCanvasElement ? canvas.getContext('webgl2') : canvas.getContext('webgl2');
      const lose = gl?.getExtension('WEBGL_lose_context');
      expect(lose, 'WEBGL_lose_context is available').toBeTruthy();
      lose!.loseContext();
      expect(gl!.isContextLost()).toBe(true);
      const after = readPixels(own.render(pattern, { look, effect }));
      expect(diff(after, before).max).toBe(0);
    } finally {
      own.dispose();
    }
  });

  it('cannot be used after dispose', () => {
    const own = new StillRunner();
    own.render(pattern);
    own.dispose();
    expect(() => own.render(pattern)).toThrow(/dispose/);
    expect(() => own.warm([])).toThrow(/dispose/);
    own.dispose(); // idempotent
  });
});
