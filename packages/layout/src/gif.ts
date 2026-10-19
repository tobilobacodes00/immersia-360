/// <reference path="./gifenc.d.ts" />
// (The reference carries gifenc's typings into every program that compiles this file, e.g. apps/web.)
import { GIFEncoder, applyPalette, quantize, type Palette } from 'gifenc';
import { drawFitted, type Drawable } from './render';

/**
 * GIF encoding (PHO-2), ported from Immersia Booth. Works on the page or in a worker
 * (OffscreenCanvas). Yields between frames so a page stays responsive.
 */

export interface GifFrame {
  image: Drawable;
  delayMs: number;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Encode frames as a looping GIF. With `sharedPalette` one palette is built from a sample of every
 * frame, which removes the colour shimmer between frames that makes motion GIFs look jittery.
 */
export async function encodeGif(
  frames: GifFrame[],
  width: number,
  height: number,
  opts: { sharedPalette?: boolean; onProgress?: (p: number) => void } = {},
): Promise<Blob> {
  const enc = GIFEncoder();
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const pixels = (f: GifFrame) => {
    ctx.clearRect(0, 0, width, height);
    drawFitted(ctx, f.image, width, height, 'cover');
    return ctx.getImageData(0, 0, width, height).data;
  };
  let shared: Palette | null = null;
  if (opts.sharedPalette) {
    const every = Math.max(1, Math.floor(frames.length / 8));
    const sample: number[] = [];
    for (const f of frames.filter((_, i) => i % every === 0).slice(0, 8)) {
      const d = pixels(f);
      for (let i = 0; i < d.length; i += 48) sample.push(d[i]!, d[i + 1]!, d[i + 2]!, 255);
    }
    shared = quantize(new Uint8ClampedArray(sample), 256);
  }
  for (let i = 0; i < frames.length; i++) {
    const data = pixels(frames[i]!);
    const palette = shared ?? quantize(data, 256);
    enc.writeFrame(applyPalette(data, palette), width, height, { palette, delay: frames[i]!.delayMs, repeat: 0 });
    opts.onProgress?.((i + 1) / frames.length);
    await tick();
  }
  enc.finish();
  return new Blob([enc.bytes().slice()], { type: 'image/gif' });
}

/** Ping-pong order for boomerangs: 1 2 3 4 3 2 (the loop returns to 1). */
export function pingPong<T>(items: T[]): T[] {
  if (items.length < 3) return items;
  return [...items, ...items.slice(1, -1).reverse()];
}
