import { messagingSize } from '@immersia/render-engine';
import { renderRecipeSchema, type RenderRecipe } from '@immersia/shared/render';
// The render engine's own browser-test fixtures: a clip whose every frame carries its index, so what
// comes out can be checked against the timeline exactly.
import { H, W, decodeOutput, makeClip } from '../../../packages/render-engine/test-browser/fixtures';
import type { SmokeCheck } from './protocol';
import { renderFromRecipe, type RenderSources } from './render-page';

/**
 * CI's smoke test of the worker's render path, run inside the same Chrome and the same bundle the
 * worker uses: a recipe goes in, the guest's files come out, and what comes out is decoded and checked.
 * (The Node half of the pipeline, the file server and the production entry, is exercised by
 * src/smoke.ts.) Not part of the production bundle.
 */

const SRC_FRAMES = 60;
const FPS = 30;

const recipe = (clip: Blob, patch: Partial<RenderRecipe> = {}, files: Partial<RenderRecipe['files']> = {}) =>
  renderRecipeSchema.parse({
    version: 2,
    output: { width: W, height: H, fps: FPS, bitrate: 6_000_000 },
    preset: 'balanced',
    slowMotion: { enabled: false, startS: 0, endS: 0, speed: 1 },
    reverse: 'none',
    look: null,
    effects: [],
    beats: [],
    seed: 7,
    music: null,
    background: null,
    intro: null,
    outro: null,
    endCard: null,
    files: { original: { bytes: clip.size, mime: 'video/mp4' }, overlay: null, endCard: null, ...files },
    derive: { poster: true, small: true },
    ...patch,
  });

const sources = (original: Blob, more: Partial<RenderSources> = {}): RenderSources => ({
  original,
  overlay: null,
  endCard: null,
  intro: null,
  outro: null,
  music: null,
  background: null,
  ...more,
});

async function png(draw: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<Blob> {
  const canvas = new OffscreenCanvas(W, H);
  draw(canvas.getContext('2d')!);
  return canvas.convertToBlob({ type: 'image/png' });
}

/** A mono 16-bit WAV of a tone: a song the page can decode. */
function wav(seconds: number): Blob {
  const rate = 22_050;
  const n = rate * seconds;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 6000), true);
  return new Blob([buf], { type: 'audio/wav' });
}

/** Mean of |a - b| over an RGBA band, for channels (a, b) as byte offsets. */
function meanDiff(rgba: Uint8ClampedArray, a: number, b: number): number {
  let sum = 0;
  for (let p = 0; p < rgba.length; p += 4) sum += Math.abs(rgba[p + a]! - rgba[p + b]!);
  return sum / (rgba.length / 4);
}
function mean(rgba: Uint8ClampedArray, c: number): number {
  let sum = 0;
  for (let p = 0; p < rgba.length; p += 4) sum += rgba[p + c]!;
  return sum / (rgba.length / 4);
}

const bytesToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

window.__fixtureClip = async () => bytesToBase64(await makeClip(SRC_FRAMES, FPS));

window.__smoke = async (mediapipeBase) => {
  const checks: SmokeCheck[] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
  const clip = await makeClip(SRC_FRAMES, FPS);
  const opts = { mediapipeBase };

  // 1. The recipe path is the render path: every output frame is exactly its source frame.
  {
    const done = await renderFromRecipe(recipe(clip), sources(clip), opts);
    const out = await decodeOutput(done.mp4);
    const indexes = out.frames.map((f) => f.index);
    check(
      'golden: every frame is its source frame',
      indexes.join() === Array.from({ length: SRC_FRAMES }, (_, i) => i).join(),
      `${out.frames.length} frames`,
    );
    check('golden: Chrome encoded it (no fallback)', done.encoder === 'native', done.encoder);
    check('golden: size', done.width === W && done.height === H, `${done.width}×${done.height}`);
    check(
      'poster is a JPEG',
      done.poster?.type === 'image/jpeg' && done.poster.size > 0,
      `${done.poster?.type} ${done.poster?.size}`,
    );
    const small = done.small ? await decodeOutput(done.small) : null;
    const want = messagingSize(W, H);
    check(
      'messaging copy decodes at its size',
      Boolean(small) &&
        small!.frames.length === SRC_FRAMES &&
        done.smallWidth === want.width &&
        done.smallHeight === want.height,
      `${small?.frames.length} frames, ${done.smallWidth}×${done.smallHeight}`,
    );
  }

  // 2. Slow motion, overlay, end card, soundtrack and a look: the pieces a real recipe has.
  {
    const overlay = await png((ctx) => {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(0, H - 40, W, 40);
    });
    const endCard = await png((ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
    });
    const r = recipe(
      clip,
      {
        slowMotion: { enabled: true, startS: 0.5, endS: 1.5, speed: 0.5 },
        look: { id: 'noir', intensity: 1 },
        music: {
          assetId: '0198f7a0-6b1c-7d3e-8f4a-5b6c7d8e9f01',
          trimStartMs: 0,
          trimEndMs: null,
          offsetMs: 0,
          fadeInMs: 200,
          fadeOutMs: 200,
          volume: 0.8,
        },
        endCard: { seconds: 1 },
      },
      { overlay: { bytes: overlay.size, mime: 'image/png' }, endCard: { bytes: endCard.size, mime: 'image/png' } },
    );
    const done = await renderFromRecipe(r, sources(clip, { overlay, endCard, music: wav(4) }), opts);
    // 0.5 s + 1 s slowed to 2 s + 0.5 s = 3 s of video, then a 1 s end card.
    check('features: frame count follows the timeline', done.frames === 4 * FPS, `${done.frames} frames`);
    const out = await decodeOutput(done.mp4);
    check('features: soundtrack is in the file', out.hasAudio, `audio ${out.hasAudio}`);
    check('features: duration', Math.abs(out.durationS - 4) < 0.2, `${out.durationS.toFixed(2)} s`);
    // The noir look has no saturation: a colourful test band comes out grey (R≈G≈B).
    const band = out.frames[20]!.band;
    const spread = (meanDiff(band, 0, 1) + meanDiff(band, 1, 2)) / 2;
    check('features: the look was applied (grey)', spread < 12, `channel spread ${spread.toFixed(1)}`);
  }

  // 3. A background, found by the on-device segmenter, in the server's headless Chrome.
  {
    const r = recipe(clip, {
      background: { kind: 'color', color: '#00ff00' },
      derive: { poster: false, small: false },
    });
    const done = await renderFromRecipe(r, sources(clip), opts);
    check('background: applied by the segmenter', done.background === 'applied', done.background);
    const out = await decodeOutput(done.mp4);
    const band = out.frames[10]!.band;
    // The clip shows no person, so the colour replaces (nearly) everything: far greener than red.
    const green = mean(band, 1) - mean(band, 0);
    check('background: the colour is behind', green > 40, `green over red ${green.toFixed(0)}`);
  }
  return checks;
};
