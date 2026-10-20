import { describe, expect, it } from 'vitest';
import type { PersonMask } from '../src/background-math';
import { Compositor, type BackgroundSetting } from '../src/gl/compositor';

/**
 * Background replacement (CAP-10) in real WebGL2, with a SYNTHETIC person mask, so no model is needed: the
 * frame has a red disc on grey, the mask is that disc, and the question is only what the stage does with
 * them. (Real segmentation quality is judged on a device, not here.)
 */
const W = 320;
const H = 240;
/** The "person": a disc left of centre and high up, so any flipped axis puts it somewhere else. */
const DISC = { x: 110, y: 80, r: 60 };
const PERSON = [200, 40, 40] as const;
const GREY = [128, 128, 128] as const;
const GREEN = '#00ff00';
const geo = { width: W, height: H, rotation: 0 as const };

function sceneFrame(person: readonly number[] = PERSON): OffscreenCanvas {
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = `rgb(${GREY.join(',')})`;
  g.fillRect(0, 0, W, H);
  g.fillStyle = `rgb(${person.join(',')})`;
  g.beginPath();
  g.arc(DISC.x, DISC.y, DISC.r, 0, Math.PI * 2);
  g.fill();
  return c;
}

/** The mask a segmenter would return for that frame: 1 inside the disc, 0 outside, on a grid 5× coarser. */
function discMask(value = 1, cell = 5): PersonMask {
  const w = W / cell;
  const h = H / cell;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5) * cell - DISC.x;
      const dy = (y + 0.5) * cell - DISC.y;
      if (Math.hypot(dx, dy) <= DISC.r) data[y * w + x] = value;
    }
  return { data, width: w, height: h };
}

type Rgb = [number, number, number];

class Shot {
  constructor(private readonly data: Uint8ClampedArray) {}
  px(x: number, y: number): Rgb {
    const i = (y * W + x) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!];
  }
}

function read(canvas: OffscreenCanvas): Shot {
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0);
  return new Shot(ctx.getImageData(0, 0, W, H).data);
}

const near = (got: Rgb, want: readonly number[], tol: number) => got.every((v, i) => Math.abs(v - want[i]!) <= tol);

/** Draw one frame through a fresh compositor; `setup` runs before it (background, mask, ...). */
function render(frame: OffscreenCanvas | ImageBitmap, setup: (c: Compositor) => void = () => undefined): Shot {
  const comp = new Compositor(new OffscreenCanvas(W, H), W, H);
  try {
    setup(comp);
    comp.drawReal(frame, geo);
    return read(comp.canvas);
  } finally {
    comp.dispose();
  }
}

const withBackground =
  (bg: BackgroundSetting, mask: PersonMask | null = discMask()) =>
  (c: Compositor) => {
    c.setBackground(bg);
    c.setMask(mask, { reset: true });
  };

describe('BackgroundStage through the compositor', () => {
  it('keeps the person and puts the colour everywhere else', () => {
    const shot = render(sceneFrame(), withBackground({ kind: 'color', color: GREEN }));
    expect(near(shot.px(DISC.x, DISC.y), PERSON, 4), `centre ${shot.px(DISC.x, DISC.y)}`).toBe(true);
    // Well inside the disc, in every direction.
    for (const [dx, dy] of [
      [-40, 0],
      [40, 0],
      [0, -40],
      [0, 40],
    ] as const)
      expect(near(shot.px(DISC.x + dx, DISC.y + dy), PERSON, 4), `inside ${dx},${dy}`).toBe(true);
    // Outside: the corners, the far side, and the spot where the disc would be if an axis were flipped.
    for (const [x, y] of [
      [4, 4],
      [W - 5, 4],
      [W - 5, H - 5],
      [4, H - 5],
      [DISC.x, H - DISC.y], // vertical flip of the person
      [W - DISC.x, DISC.y], // horizontal flip
      [W - DISC.x, H - DISC.y],
    ] as const)
      expect(near(shot.px(x, y), [0, 255, 0], 4), `outside ${x},${y}: ${shot.px(x, y)}`).toBe(true);
  });

  it('feathers the edge: a ramp of several pixels, never a one-pixel step', () => {
    const shot = render(sceneFrame(), withBackground({ kind: 'color', color: GREEN }));
    // Along the row through the disc's centre, across its right edge. Green falls from 255 (colour) to
    // 40 (person) over the edge.
    const row = Array.from({ length: 24 }, (_, i) => shot.px(DISC.x + DISC.r - 12 + i, DISC.y)[1]);
    const range = 255 - PERSON[1];
    const steps = row.slice(1).map((v, i) => Math.abs(v - row[i]!));
    expect(Math.max(...steps), `row ${row.join(' ')}`).toBeLessThan(range * 0.6);
    const between = row.filter((v) => v > PERSON[1] + range * 0.15 && v < 255 - range * 0.15).length;
    expect(between, `row ${row.join(' ')}`).toBeGreaterThanOrEqual(2);
    // ...and it does go all the way across.
    expect(row[0]).toBeLessThan(PERSON[1] + 15);
    expect(row[row.length - 1]).toBeGreaterThan(240);
  });

  it('snaps a soft mask to the edge in the picture (the model is unsure across ±10 px, the frame is not)', () => {
    // What a segmenter really returns: confidence that ramps from 0 to 1 over a band round the person. An
    // upsample that ignored the picture would leave that band as a wide, offset gradient; guided by the
    // frame it collapses onto the disc's own edge, leaving only the ~2–3 px feather.
    const cell = 5;
    const w = W / cell;
    const h = H / cell;
    const soft = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dist = Math.hypot((x + 0.5) * cell - DISC.x, (y + 0.5) * cell - DISC.y);
        soft[y * w + x] = Math.min(1, Math.max(0, 0.5 + (DISC.r - dist) / 20));
      }
    const shot = render(
      sceneFrame(),
      withBackground({ kind: 'color', color: GREEN }, { data: soft, width: w, height: h }),
    );
    const low = PERSON[1] + (255 - PERSON[1]) * 0.1;
    const high = PERSON[1] + (255 - PERSON[1]) * 0.9;
    for (const [ux, uy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      // Position (in px along the ray) where the green channel first reaches a level.
      const crossing = (level: number) => {
        let prev = shot.px(DISC.x + ux * (DISC.r - 14), DISC.y + uy * (DISC.r - 14))[1];
        for (let d = DISC.r - 13; d < DISC.r + 14; d++) {
          const v = shot.px(DISC.x + ux * d, DISC.y + uy * d)[1];
          if (prev < level && v >= level) return d - 1 + (level - prev) / (v - prev);
          prev = v;
        }
        return NaN;
      };
      const half = crossing((PERSON[1] + 255) / 2);
      const width = crossing(high) - crossing(low);
      // Measured: the half-way point lands within 0.7 px of the circle (index coordinates carry ±0.5) and the
      // 10–90% width is 2.7 px; without the guide the same mask gives 1.7 px off and 4.9 px wide.
      expect(Math.abs(half - DISC.r), `direction ${ux},${uy}: half-way at ${half}`).toBeLessThan(1.2);
      expect(width, `direction ${ux},${uy}: 10–90% width ${width}`).toBeLessThan(3.6);
    }
  });

  it('with no background set, the output is exactly the input', () => {
    const frame = sceneFrame();
    const plain = render(frame);
    // Straight through the compositor: the same picture (identity crop, sampled at texel centres).
    const direct = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
    direct.drawImage(frame, 0, 0);
    const input = direct.getImageData(0, 0, W, H).data;
    let worst = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const got = plain.px(x, y);
        for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(got[k]! - input[(y * W + x) * 4 + k]!));
      }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('switching the background off again leaves nothing behind: byte-identical to never having set one', () => {
    const frame = sceneFrame();
    const never = render(frame);
    const cleared = render(frame, (c) => {
      withBackground({ kind: 'color', color: GREEN })(c);
      c.drawReal(frame, geo); // a frame with the background on
      c.setBackground(null);
    });
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) expect(cleared.px(x, y)).toEqual(never.px(x, y));
  });

  it('a background without a mask yet passes the frame through untouched', () => {
    const frame = sceneFrame();
    const never = render(frame);
    const waiting = render(frame, (c) => c.setBackground({ kind: 'color', color: GREEN }));
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) expect(waiting.px(x, y)).toEqual(never.px(x, y));
    // And so does a mask that was taken away again (the footage has ended).
    const ended = render(frame, (c) => {
      withBackground({ kind: 'color', color: GREEN })(c);
      c.setMask(null);
    });
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) expect(ended.px(x, y)).toEqual(never.px(x, y));
  });

  it('puts a picture behind the person, scaled to cover (not stretched)', () => {
    // A 2:1 picture, left half blue and right half yellow, with a black stripe across its middle tenth.
    const pic = new OffscreenCanvas(200, 100);
    const g = pic.getContext('2d')!;
    g.fillStyle = '#2040ff';
    g.fillRect(0, 0, 100, 100);
    g.fillStyle = '#ffd000';
    g.fillRect(100, 0, 100, 100);
    g.fillStyle = '#000000';
    g.fillRect(0, 45, 200, 10);
    const shot = render(sceneFrame(), withBackground({ kind: 'image', image: pic, width: 200, height: 100 }));
    // Covering 4:3 from 2:1 shows the middle two thirds of the width: the split stays in the middle.
    expect(near(shot.px(20, 200), [32, 64, 255], 6), `left ${shot.px(20, 200)}`).toBe(true);
    expect(near(shot.px(300, 200), [255, 208, 0], 6), `right ${shot.px(300, 200)}`).toBe(true);
    // The stripe: its middle tenth of the height is the middle tenth of the frame (scaled 2.4×: 24 rows).
    expect(near(shot.px(300, H / 2), [0, 0, 0], 6), `stripe ${shot.px(300, H / 2)}`).toBe(true);
    expect(near(shot.px(300, H / 2 - 30), [255, 208, 0], 6)).toBe(true);
    // The person is still on top.
    expect(near(shot.px(DISC.x, DISC.y), PERSON, 4)).toBe(true);
  });

  it('blurs the frame behind the person without letting the person bleed into it', () => {
    const shot = render(sceneFrame(), withBackground({ kind: 'blur' }));
    expect(near(shot.px(DISC.x, DISC.y), PERSON, 4)).toBe(true);
    // Just outside the disc the background is the grey it was: a plain blur of the whole frame would have
    // pulled red in from the disc, but the person is left out of the blur.
    for (const [dx, dy] of [
      [DISC.r + 9, 0],
      [0, DISC.r + 9],
      [-(DISC.r + 9), 0],
    ] as const) {
      const [r, gr, b] = shot.px(DISC.x + dx, DISC.y + dy);
      // (A blur that kept the person in measures 13 here; with the person left out, about 0.)
      expect(Math.abs(r - gr), `${dx},${dy} → ${r},${gr},${b}`).toBeLessThan(5);
      expect(Math.abs(b - gr)).toBeLessThan(5);
    }
  });

  it('blur really blurs: a hard edge in the background becomes a gradient', () => {
    // No person at all (an empty mask): the output is the whole frame blurred. Left half white, right black.
    const split = new OffscreenCanvas(W, H);
    const g = split.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W / 2, H);
    g.fillStyle = '#000000';
    g.fillRect(W / 2, 0, W / 2, H);
    const empty: PersonMask = { data: new Float32Array((W / 5) * (H / 5)), width: W / 5, height: H / 5 };
    const shot = render(split, withBackground({ kind: 'blur' }, empty));
    const row = Array.from({ length: W }, (_, x) => shot.px(x, 120)[0]);
    expect(row[W / 2 - 1]!).toBeGreaterThan(60);
    expect(row[W / 2 - 1]!).toBeLessThan(200);
    expect(row[W / 2 - 45]!).toBeGreaterThan(235);
    expect(row[W / 2 + 45]!).toBeLessThan(20);
    // The transition is wide (a sharp frame would go 255 → 0 in a pixel).
    const wide = row.filter((v) => v > 30 && v < 225).length;
    expect(wide).toBeGreaterThan(8);
  });

  it('smooths the mask over time: a wobble between frames is averaged, a hard change is followed', () => {
    const frame = sceneFrame();
    const comp = new Compositor(new OffscreenCanvas(W, H), W, H);
    try {
      comp.setBackground({ kind: 'color', color: GREEN });
      comp.setMask(discMask(0.9), { reset: true });
      comp.drawReal(frame, geo);
      const first = read(comp.canvas).px(DISC.x, DISC.y)[0];
      // The model now says 0.5 for the same pixels (jitter): smoothing keeps most of the person.
      comp.setMask(discMask(0.5));
      comp.drawReal(frame, geo);
      const smoothed = read(comp.canvas).px(DISC.x, DISC.y)[0];
      // The same 0.5 on a fresh start (reset) shows what no smoothing would have given.
      comp.setMask(discMask(0.5), { reset: true });
      comp.drawReal(frame, geo);
      const raw = read(comp.canvas).px(DISC.x, DISC.y)[0];
      expect(first).toBeGreaterThan(190); // 0.9 is clearly person
      expect(smoothed, `smoothed ${smoothed}, raw ${raw}`).toBeGreaterThan(raw + 50);
      expect(smoothed).toBeLessThanOrEqual(first);
      // A hard change (the person walks off): followed at once, no ghost.
      comp.setMask(discMask(0), { reset: false });
      comp.drawReal(frame, geo);
      const gone = read(comp.canvas).px(DISC.x, DISC.y);
      expect(near(gone, [0, 255, 0], 6), `gone ${gone}`).toBe(true);
    } finally {
      comp.dispose();
    }
  });

  it('reads the composed frame back top row first, small, for the segmenter', () => {
    const frame = new OffscreenCanvas(W, H);
    const g = frame.getContext('2d')!;
    g.fillStyle = '#0000ff';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, W, 30); // a red bar across the TOP
    const comp = new Compositor(new OffscreenCanvas(W, H), W, H);
    try {
      expect(comp.readForSegmentation(64)).toBeNull(); // nothing to segment for until a background is set
      comp.setBackground({ kind: 'blur' });
      comp.composeReal(frame, geo);
      const small = comp.readForSegmentation(64)!;
      expect(Math.max(small.width, small.height)).toBe(64);
      expect(small.width / small.height).toBeCloseTo(W / H, 1);
      const at = (x: number, y: number) =>
        Array.from(small.data.subarray((y * small.width + x) * 4, (y * small.width + x) * 4 + 3));
      expect(at(small.width >> 1, 1)).toEqual([255, 0, 0]); // top row is red
      expect(at(small.width >> 1, small.height - 2)).toEqual([0, 0, 255]); // bottom is blue
    } finally {
      comp.dispose();
    }
  });

  it('cuts the whole thing to the camera orientation: a rotated source gets the mask of what is shown', () => {
    // The mask describes the frame as COMPOSED (output space), so a source recorded on its side, once
    // rotated into place, is replaced around the person wherever they end up on screen.
    const side = new OffscreenCanvas(H, W); // recorded 240 × 320, to be shown rotated 90° as 320 × 240
    const g = side.getContext('2d')!;
    g.fillStyle = `rgb(${GREY.join(',')})`;
    g.fillRect(0, 0, H, W);
    // Rotation 90 maps display (x, y) to source (y, W - x): put the disc where display (110, 80) lands.
    g.fillStyle = `rgb(${PERSON.join(',')})`;
    g.beginPath();
    g.arc(DISC.y, W - DISC.x, DISC.r, 0, Math.PI * 2);
    g.fill();
    const comp = new Compositor(new OffscreenCanvas(W, H), W, H);
    try {
      withBackground({ kind: 'color', color: GREEN })(comp);
      comp.drawReal(side, { width: H, height: W, rotation: 90 });
      const shot = read(comp.canvas);
      expect(near(shot.px(DISC.x, DISC.y), PERSON, 6), `person at ${shot.px(DISC.x, DISC.y)}`).toBe(true);
      expect(near(shot.px(W - 5, H - 5), [0, 255, 0], 6)).toBe(true);
    } finally {
      comp.dispose();
    }
  });
});
