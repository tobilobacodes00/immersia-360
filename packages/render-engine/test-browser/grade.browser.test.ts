import { afterEach, describe, expect, it } from 'vitest';
import { findEffect, findLook, lookUniforms, LOOK_FRAG } from '@immersia/effects/shaders';
import { Compositor } from '../src/gl/compositor';
import { GradePreview } from '../src/preview';

/**
 * The look and effects stage around the things that are NOT the guest's footage: intro, outro and
 * end cards that are video clips, and a canvas that is reused for a new preview.
 */
const W = 160;
const H = 120;
const geo = { width: W, height: H, rotation: 0 as const };

type Rgb = [number, number, number];

function solid(rgb: Rgb): ImageBitmap {
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = `rgb(${rgb.join(',')})`;
  g.fillRect(0, 0, W, H);
  return c.transferToImageBitmap();
}

/** The middle pixel of whatever a WebGL canvas shows right now. */
function centre(canvas: OffscreenCanvas | HTMLCanvasElement): Rgb {
  const c = new OffscreenCanvas(canvas.width, canvas.height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(canvas, 0, 0);
  const d = g.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
  return [d[0]!, d[1]!, d[2]!];
}

const maxDiff = (a: Rgb, b: Rgb) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

const RED: Rgb = [200, 40, 40];
const BLUE: Rgb = [40, 60, 210];

const monoLook = () => ({
  frag: LOOK_FRAG,
  uniforms: lookUniforms(findLook('mono')!.params, 1),
});
const echo = () => ({ def: findEffect('echo-trail')!, intensity: 1, colorMode: null });

const compositors: Compositor[] = [];
function compositor(grade: 'none' | 'look' | 'echo' = 'none') {
  const c = new Compositor(new OffscreenCanvas(W, H), W, H);
  compositors.push(c);
  if (grade === 'look') c.setGrade(monoLook(), [echo()], 0);
  if (grade === 'echo') c.setGrade(null, [echo()], 0);
  return c;
}
afterEach(() => {
  while (compositors.length) compositors.pop()!.dispose();
});

describe('clip cards (intro, outro, end card) are not graded', () => {
  it('a card frame drawn ungraded equals the plain output; the same frame graded does not', () => {
    const graded = compositor('look');
    const plain = compositor('none');

    plain.drawReal(solid(RED), geo);
    const reference = centre(plain.canvas as OffscreenCanvas);

    graded.drawReal(solid(RED), geo, false);
    const card = centre(graded.canvas as OffscreenCanvas);
    expect(maxDiff(card, reference), `card ${card} vs plain ${reference}`).toBeLessThanOrEqual(2);
    // Still the card's own colours, not the look's black and white.
    expect(card[0] - card[1]).toBeGreaterThan(80);

    graded.drawReal(solid(RED), geo);
    const footage = centre(graded.canvas as OffscreenCanvas);
    // The Mono look removes the colour: this is what the guest's footage gets and the card must not.
    expect(Math.abs(footage[0] - footage[1])).toBeLessThan(6);
    expect(maxDiff(footage, reference)).toBeGreaterThan(30);
  });

  it('card frames never reach the effect history: the first frame of the take has no ghosts', () => {
    // An intro clip (ungraded), then the take starts: history is reset, then a guest frame.
    const withIntro = compositor('echo');
    withIntro.drawReal(solid(RED), geo, false);
    withIntro.drawReal(solid(RED), geo, false);
    withIntro.resetHistory();
    withIntro.drawReal(solid(BLUE), geo);
    const first = centre(withIntro.canvas as OffscreenCanvas);

    const alone = compositor('echo');
    alone.drawReal(solid(BLUE), geo);
    const reference = centre(alone.canvas as OffscreenCanvas);
    expect(maxDiff(first, reference), `${first} vs ${reference}`).toBeLessThanOrEqual(2);
  });

  it('resetHistory is what keeps earlier frames out: without it the echo trail shows them', () => {
    const noReset = compositor('echo');
    noReset.drawReal(solid(RED), geo);
    noReset.drawReal(solid(BLUE), geo);
    const ghosted = centre(noReset.canvas as OffscreenCanvas);

    const reset = compositor('echo');
    reset.drawReal(solid(RED), geo);
    reset.resetHistory();
    reset.drawReal(solid(BLUE), geo);
    const clean = centre(reset.canvas as OffscreenCanvas);

    const alone = compositor('echo');
    alone.drawReal(solid(BLUE), geo);
    const reference = centre(alone.canvas as OffscreenCanvas);

    expect(maxDiff(clean, reference)).toBeLessThanOrEqual(2);
    // The check can tell the two apart: red bleeds into the blue frame when history is kept.
    expect(maxDiff(ghosted, reference)).toBeGreaterThan(20);
  });
});

const once = (target: EventTarget, type: string) =>
  new Promise<void>((resolve) => target.addEventListener(type, () => resolve(), { once: true }));

describe('GradePreview on a canvas that is reused', () => {
  const settings = { look: { id: 'mono', intensity: 1 }, effects: [] };

  function previewOn(canvas: HTMLCanvasElement, width: number, height: number) {
    const p = new GradePreview(canvas, width, height);
    p.configure(settings);
    return p;
  }

  it('a new preview on the same canvas still draws the look after the old one was disposed', () => {
    const canvas = document.createElement('canvas');
    const first = previewOn(canvas, 64, 48);
    first.draw(solid(RED));
    first.dispose();

    // A new camera resolution: another preview, on the same canvas element.
    const second = previewOn(canvas, 80, 60);
    second.draw(solid(RED));
    const [r, g, b] = centre(canvas);
    expect(Math.abs(r - g), `centre ${[r, g, b]}`).toBeLessThan(6);
    expect(r).toBeGreaterThan(20);
    second.dispose();
  });

  it('draws again after the GPU takes the context away and gives it back', async (ctx) => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const preview = previewOn(canvas, 64, 48);
    preview.draw(solid(RED));

    const ext = (preview as unknown as { gl: WebGL2RenderingContext }).gl.getExtension('WEBGL_lose_context')!;
    const lost = once(canvas, 'webglcontextlost');
    ext.loseContext();
    await lost;
    expect(preview.contextLost).toBe(true);
    // Nothing is drawn (and nothing throws) while it is gone.
    expect(() => preview.draw(solid(RED))).not.toThrow();

    const restored = once(canvas, 'webglcontextrestored');
    ext.restoreContext();
    // Chrome hands the context back on a later rendering frame, and Vitest runs test files side by side
    // in frames it does not render while they are off screen: there the event may never come. That
    // says nothing about the preview, so the test stops there rather than hang.
    const back = await Promise.race([
      restored.then(() => true),
      new Promise<boolean>((r) => setTimeout(r, 10_000, false)),
    ]);
    if (!back) {
      canvas.remove();
      ctx.skip('this browser frame did not restore the lost WebGL context');
    }
    expect(preview.contextLost).toBe(false);

    preview.draw(solid(RED));
    const [r, g] = centre(canvas);
    expect(Math.abs(r - g)).toBeLessThan(6);
    expect(r).toBeGreaterThan(20);
    preview.dispose();
    canvas.remove();
  });

  it('settings with nothing to apply show the source untouched', () => {
    const canvas = document.createElement('canvas');
    const preview = new GradePreview(canvas, 64, 48);
    // An id that is in no catalogue is skipped, so there is no stage to build.
    preview.configure({ look: null, effects: [{ id: 'no-such-effect', intensity: 1, colorMode: null }] });
    preview.draw(solid(RED));
    const [r, g] = centre(canvas);
    expect(r - g).toBeGreaterThan(80);
    preview.dispose();
  });
});
