import { describe, expect, it } from 'vitest';
import { coverCrop, zoomedCrop } from '../src/gl/crop';
import {
  CROSSFADE_S,
  MAX_STILL_S,
  MAX_VIDEO_CLIP_S,
  MIN_CLIP_S,
  MIN_STILL_S,
  clipSecondsFor,
  distributeSeconds,
  easeInOut,
  kenBurns,
  layersAt,
  medianGap,
  planFrames,
  planReel,
  playOrder,
  snapBoundaries,
  sourceRefs,
  type ReelClip,
  type ReelOptions,
} from '../src/montage-plan';

const video = (i: number, patch: Partial<ReelClip> = {}): ReelClip => ({
  id: `v${i}`,
  kind: 'video',
  usable: { fromS: 1, toS: 9 },
  weight: 1 - i / 100,
  capturedAtMs: i * 1000,
  ...patch,
});
const still = (i: number, patch: Partial<ReelClip> = {}): ReelClip => ({
  id: `s${i}`,
  kind: 'still',
  weight: 1 - i / 100,
  capturedAtMs: i * 1000,
  ...patch,
});
const many = (n: number, make: (i: number) => ReelClip = video) => Array.from({ length: n }, (_, i) => make(i));

const opts: ReelOptions = { targetS: 60, fps: 30, introS: 2.5, endS: 3, style: 'crossfade', beats: [] };
/** A steady beat: `bpm`, the first at `first`, up to `until` seconds. */
const grid = (bpm: number, first: number, until: number) =>
  Array.from({ length: Math.floor((until - first) / (60 / bpm)) + 1 }, (_, i) => first + (i * 60) / bpm);
const onBeat = (t: number, beats: number[]) => beats.some((b) => Math.abs(b - t) < 1e-6);

describe('distributeSeconds', () => {
  it('shares in proportion to the weights', () => {
    expect(distributeSeconds(8, [3, 1], [0, 0], [10, 10])).toEqual([6, 2]);
  });

  it('hands what a full slot cannot take to the others', () => {
    expect(distributeSeconds(10, [1, 1], [1, 1], [3, 10])).toEqual([3, 7]);
  });

  it('keeps every minimum even when they add up to more than the total', () => {
    expect(distributeSeconds(2, [1, 1], [2, 2], [5, 5])).toEqual([2, 2]);
  });

  it('falls short of the total only when every slot is full', () => {
    expect(distributeSeconds(100, [1, 1], [0, 0], [3, 3])).toEqual([3, 3]);
  });
});

describe('snapBoundaries', () => {
  const half = grid(120, 0, 7);
  const limits = { minLen: [0, 1, 1], maxLen: [0, 6, 6] };

  it('moves each boundary to the nearest beat within reach', () => {
    expect(snapBoundaries([2.6, 6.1], half, { tolerance: 0.4, ...limits })).toEqual([2.5, 6]);
  });

  it('leaves a boundary alone when no beat is close enough', () => {
    expect(snapBoundaries([2.6, 6.1], [0, 4, 8], { tolerance: 0.4, ...limits })).toEqual([2.6, 6.1]);
  });

  it('never makes a clip shorter or longer than its limits allow', () => {
    // 3.1 would snap to 3.0 (a 0.5 s clip), but the clip before it must last at least 1 s.
    const out = snapBoundaries([2.5, 3.1], half, { tolerance: 0.4, minLen: [0, 1, 1], maxLen: [0, 6, 6] });
    expect(out[1]! - out[0]!).toBeGreaterThanOrEqual(1 - 1e-9);
    // Out of reach of every beat: pulled back inside the longest allowed length.
    expect(snapBoundaries([0, 9], [0, 9.2], { tolerance: 0.5, minLen: [0, 1], maxLen: [0, 4] })).toEqual([0, 4]);
  });
});

describe('medianGap and playOrder', () => {
  it('takes the usual gap, so a missed beat does not skew it', () => {
    expect(medianGap([0, 0.5, 1, 2.5, 3, 3.5])).toBeCloseTo(0.5);
    expect(medianGap([1])).toBeNull();
  });

  it('opens with the best clip, then follows the order things happened', () => {
    const ranked = [{ capturedAtMs: 50 }, { capturedAtMs: 40 }, { capturedAtMs: 10 }, { capturedAtMs: 30 }];
    expect(playOrder(ranked).map((c) => c.capturedAtMs)).toEqual([50, 10, 30, 40]);
    expect(playOrder([])).toEqual([]);
  });
});

describe('planReel', () => {
  it.each([30, 60, 90] as const)('lands on %s s and uses a pace that suits it', (targetS) => {
    for (const style of ['crossfade', 'cut'] as const) {
      const plan = planReel(many(60), { ...opts, targetS, style });
      expect(Math.abs(plan.totalS - targetS)).toBeLessThan(1);
      expect(plan.frames).toBe(Math.round(plan.totalS * 30));
      const perClip = (plan.totalS - 5.5) / plan.clips;
      expect(Math.abs(perClip - clipSecondsFor(targetS))).toBeLessThan(0.8);
    }
  });

  it('bookends the clips with the cards and covers the whole timeline', () => {
    const plan = planReel(many(30), opts);
    const first = plan.entries[0]!;
    const last = plan.entries.at(-1)!;
    expect([first.role, first.startS, first.fadeInS]).toEqual(['intro', 0, 0]);
    expect([last.role, last.endS]).toEqual(['end', plan.totalS]);
    expect(plan.entries.filter((e) => e.role === 'clip')).toHaveLength(plan.clips);
    plan.entries.forEach((e) => expect(e.endS).toBeGreaterThan(e.startS));
  });

  it('cross-fades overlap by the fade, and cuts meet exactly', () => {
    const fade = planReel(many(30), opts).entries;
    fade.slice(1).forEach((e, i) => {
      expect(fade[i]!.endS - e.startS).toBeCloseTo(CROSSFADE_S, 9);
      expect(e.fadeInS).toBe(CROSSFADE_S);
    });
    const cut = planReel(many(30), { ...opts, style: 'cut' }).entries;
    cut.slice(1).forEach((e, i) => {
      expect(cut[i]!.endS).toBeCloseTo(e.startS, 9);
      expect(e.fadeInS).toBe(0);
    });
  });

  it('puts the cuts on the beat of the music', () => {
    const beats = grid(120, 0.13, 120);
    const cut = planReel(many(40), { ...opts, style: 'cut', beats });
    expect(cut.beatSynced).toBe(true);
    for (const e of cut.entries.slice(1)) expect(onBeat(e.startS, beats)).toBe(true);
    // A cross-fade is centred on the beat.
    const fade = planReel(many(40), { ...opts, beats });
    expect(fade.beatSynced).toBe(true);
    for (const e of fade.entries.filter((x) => x.role === 'clip'))
      expect(onBeat(e.startS + CROSSFADE_S / 2, beats)).toBe(true);
    expect(Math.abs(fade.totalS - 60)).toBeLessThan(1);
  });

  it('is not synced without enough beats to follow', () => {
    expect(planReel(many(40), { ...opts, beats: [1, 1.5, 2] }).beatSynced).toBe(false);
    expect(planReel(many(40), opts).beatSynced).toBe(false);
  });

  it('plays the best clip first and the rest in the order they were captured', () => {
    const clips = [10, 90, 20, 70, 30, 60, 40, 50].map((at, i) => video(i, { capturedAtMs: at }));
    const order = planReel(clips, { ...opts, targetS: 30 })
      .entries.filter((e) => e.role === 'clip')
      .map((e) => clips[e.clip!]!.capturedAtMs);
    expect(order[0]).toBe(10);
    expect(order.slice(1)).toEqual([...order.slice(1)].sort((a, b) => a - b));
  });

  it('keeps better clips on screen a little longer', () => {
    const plan = planReel([...many(20, (i) => video(i, { weight: i === 0 ? 1 : 0 }))], opts);
    const lengths = plan.entries.filter((e) => e.role === 'clip').map((e) => ({ id: e.clip!, len: e.endS - e.startS }));
    const best = lengths.find((l) => l.id === 0)!;
    expect(best.len).toBeGreaterThan(Math.max(...lengths.filter((l) => l.id !== 0).map((l) => l.len)) - 1e-9);
  });

  it('is shorter, not padded, when there is too little footage', () => {
    const plan = planReel(many(3), { ...opts, targetS: 90 });
    expect(plan.clips).toBe(3);
    expect(plan.totalS).toBeLessThan(60);
    for (const e of plan.entries.filter((x) => x.role === 'clip'))
      expect(e.endS - e.startS).toBeLessThanOrEqual(MAX_VIDEO_CLIP_S + CROSSFADE_S + 1e-9);
  });

  it('leaves out videos with too little footage and says which', () => {
    const clips = [video(0, { usable: { fromS: 1, toS: 2 } }), ...many(10, (i) => video(i + 1))];
    const plan = planReel(clips, { ...opts, targetS: 30 });
    expect(plan.dropped).toEqual(['v0']);
    expect(plan.entries.some((e) => e.clip === 0)).toBe(false);
  });

  it('only plays what a video has to give, from the middle of it', () => {
    const clips = many(20, (i) => video(i, { usable: { fromS: 2, toS: 2 + 3 + (i % 4) } }));
    for (const style of ['crossfade', 'cut'] as const) {
      const plan = planReel(clips, { ...opts, style });
      for (const e of plan.entries.filter((x) => x.role === 'clip')) {
        const u = clips[e.clip!]!.usable!;
        expect(e.sourceInS).toBeGreaterThanOrEqual(u.fromS - 1e-9);
        expect(e.sourceInS + (e.endS - e.startS)).toBeLessThanOrEqual(u.toS + 1e-9);
      }
    }
  });

  it('gives a photo strip time to be read, and no more than a still deserves', () => {
    const plan = planReel(many(40, still), { ...opts, targetS: 30 });
    for (const e of plan.entries.filter((x) => x.role === 'clip')) {
      const len = e.endS - e.startS - CROSSFADE_S;
      expect(len).toBeGreaterThanOrEqual(MIN_STILL_S - 1e-9);
      expect(len).toBeLessThanOrEqual(MAX_STILL_S + 1e-9);
      expect(e.sourceInS).toBe(0);
    }
    expect(Math.abs(plan.totalS - 30)).toBeLessThan(1);
  });

  it('mixes videos and stills in one reel', () => {
    const plan = planReel([...many(8), ...many(8, (i) => still(i + 8))], opts);
    const kinds = new Set(plan.entries.filter((e) => e.role === 'clip').map((e) => e.kind));
    expect(kinds).toEqual(new Set(['video', 'still']));
  });

  it('makes a reel of just the cards when there is nothing else, and an empty one when there is not even that', () => {
    const cards = planReel([], opts);
    expect(cards.entries.map((e) => e.role)).toEqual(['intro', 'end']);
    expect(cards.totalS).toBeCloseTo(5.5);
    expect(cards.clips).toBe(0);
    const empty = planReel([], { ...opts, introS: 0, endS: 0 });
    expect([empty.entries.length, empty.frames]).toEqual([0, 0]);
  });

  it('can run without cards: the first clip opens the reel and the last one closes it', () => {
    const plan = planReel(many(30), { ...opts, introS: 0, endS: 0 });
    const first = plan.entries[0]!;
    expect([first.role, first.startS, first.fadeInS]).toEqual(['clip', 0, 0]);
    expect(plan.entries.at(-1)!.endS).toBeCloseTo(plan.totalS, 9);
    expect(Math.abs(plan.totalS - 60)).toBeLessThan(1);
  });

  it('never asks for less than a clip needs to be understood', () => {
    const plan = planReel(many(60), { ...opts, targetS: 30 });
    for (const e of plan.entries.filter((x) => x.role === 'clip'))
      expect(e.endS - e.startS).toBeGreaterThanOrEqual(MIN_CLIP_S);
  });
});

describe('layersAt and planFrames', () => {
  const plan = planReel(many(30), opts);

  it('opens on the first card alone', () => {
    const { layers, mix } = layersAt(plan, 0);
    expect(layers).toEqual([{ entry: 0, sourceS: 0, progress: 0 }]);
    expect(mix).toBe(0);
  });

  it('cross-fades from one entry to the next, 0 to 1 over the fade', () => {
    const next = plan.entries[1]!;
    const before = layersAt(plan, next.startS - 0.01);
    expect(before.layers).toHaveLength(1);
    const mixes = [0.05, 0.15, 0.25, 0.35, 0.45].map((dt) => layersAt(plan, next.startS + dt));
    for (const m of mixes) expect(m.layers.map((l) => l.entry)).toEqual([0, 1]);
    const values = mixes.map((m) => m.mix);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values[0]).toBeGreaterThan(0);
    expect(values.at(-1)).toBeLessThan(1);
    expect(layersAt(plan, next.startS + CROSSFADE_S + 0.01).layers.map((l) => l.entry)).toEqual([1]);
  });

  it('a cut shows one entry or the other, never both', () => {
    const cut = planReel(many(30), { ...opts, style: 'cut' });
    const at = cut.entries[1]!.startS;
    expect(layersAt(cut, at - 0.001).layers.map((l) => l.entry)).toEqual([0]);
    expect(layersAt(cut, at).layers.map((l) => l.entry)).toEqual([1]);
  });

  it('advances a video at normal speed from where its window starts', () => {
    const e = plan.entries[2]!;
    const start = layersAt(plan, e.startS + 1e-6).layers.find((l) => l.entry === 2)!;
    const later = layersAt(plan, e.startS + 1.25).layers.find((l) => l.entry === 2)!;
    expect(start.sourceS).toBeCloseTo(e.sourceInS, 4);
    expect(later.sourceS - start.sourceS).toBeCloseTo(1.25, 4);
    expect(later.progress).toBeGreaterThan(start.progress);
  });

  it('holds the last entry for a final frame a rounding error past the end', () => {
    const { layers } = layersAt(plan, plan.totalS + 0.01);
    expect(layers.map((l) => l.entry)).toEqual([plan.entries.length - 1]);
  });

  it('has a layer list for every output frame, moving forward through the entries', () => {
    const frames = planFrames(plan, 30);
    expect(frames).toHaveLength(plan.frames);
    let lastEntry = 0;
    for (const f of frames) {
      expect(f.layers.length).toBeLessThanOrEqual(2);
      expect(f.layers.at(-1)!.entry).toBeGreaterThanOrEqual(lastEntry);
      lastEntry = f.layers.at(-1)!.entry;
    }
    // Every entry is shown on at least one frame.
    const shown = new Set(frames.flatMap((f) => f.layers.map((l) => l.entry)));
    expect(shown.size).toBe(plan.entries.length);
  });

  it('asks each video for strictly increasing source times, so its frames come in order', () => {
    const frames = planFrames(plan, 30);
    const seen = new Map<number, number[]>();
    for (const f of frames) for (const l of f.layers) seen.set(l.entry, [...(seen.get(l.entry) ?? []), l.sourceS]);
    for (const [entry, times] of seen)
      if (plan.entries[entry]!.kind === 'video') expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('kenBurns', () => {
  const view = (o: { imageW: number; imageH: number; seq: number }, progress: number) =>
    kenBurns(progress, { ...o, outW: 1080, outH: 1920 });

  it('stays gentle and inside the picture for every still and every moment', () => {
    for (const shape of [
      { imageW: 400, imageH: 1200 },
      { imageW: 1920, imageH: 1080 },
      { imageW: 1080, imageH: 1920 },
      { imageW: 1000, imageH: 1000 },
    ])
      for (let seq = 0; seq < 6; seq++)
        for (let k = 0; k <= 10; k++) {
          const m = view({ ...shape, seq }, k / 10);
          expect(m.zoom).toBeGreaterThanOrEqual(1);
          expect(m.zoom).toBeLessThanOrEqual(1.08 + 1e-9);
          expect(Math.abs(m.panX)).toBeLessThanOrEqual(1);
          expect(Math.abs(m.panY)).toBeLessThanOrEqual(1);
          const crop = zoomedCrop(coverCrop(shape.imageW, shape.imageH, 0, 1080, 1920), m.zoom, m.panX, m.panY);
          for (const axis of [0, 1] as const) {
            expect(crop.offset[axis]).toBeGreaterThanOrEqual(-1e-9);
            expect(crop.offset[axis] + crop.scale[axis]).toBeLessThanOrEqual(1 + 1e-9);
          }
        }
  });

  it('travels a tall photo strip along its length, and the next one the other way', () => {
    const strip = { imageW: 400, imageH: 1200 };
    const down = [0, 0.5, 1].map((p) => view({ ...strip, seq: 0 }, p).panY);
    expect(down[0]).toBeLessThan(-0.8);
    expect(down[1]).toBeCloseTo(0, 6);
    expect(down[2]).toBeGreaterThan(0.8);
    const up = [0, 1].map((p) => view({ ...strip, seq: 1 }, p).panY);
    expect(up[0]).toBeGreaterThan(0.8);
    expect(up[1]).toBeLessThan(-0.8);
    expect(view({ ...strip, seq: 0 }, 0.3).panX).toBe(0);
  });

  it('travels a wide picture sideways', () => {
    const wide = { imageW: 3000, imageH: 1000, seq: 0 };
    expect(view(wide, 0).panX).toBeLessThan(-0.8);
    expect(view(wide, 1).panX).toBeGreaterThan(0.8);
  });

  it('only drifts over a picture that already fits the frame', () => {
    const fits = { imageW: 1080, imageH: 1920, seq: 0 };
    for (let k = 0; k <= 10; k++) {
      const m = view(fits, k / 10);
      expect(Math.abs(m.panX)).toBeLessThanOrEqual(0.35);
      expect(Math.abs(m.panY)).toBeLessThanOrEqual(0.35);
    }
  });

  it('pushes in, and every third still pulls out', () => {
    const strip = { imageW: 400, imageH: 1200 };
    expect(view({ ...strip, seq: 0 }, 0).zoom).toBe(1);
    expect(view({ ...strip, seq: 0 }, 1).zoom).toBeCloseTo(1.08);
    expect(view({ ...strip, seq: 2 }, 0).zoom).toBeCloseTo(1.08);
    expect(view({ ...strip, seq: 2 }, 1).zoom).toBe(1);
  });
});

describe('zoomedCrop', () => {
  const cover = coverCrop(400, 1200, 0, 1080, 1920);

  it('is the cover crop at zoom 1 and no pan', () => {
    const z = zoomedCrop(cover, 1, 0, 0);
    expect(z.scale[0]).toBeCloseTo(cover.scale[0]);
    expect(z.offset[1]).toBeCloseTo(cover.offset[1]);
  });

  it('moves the window to either edge of the picture with a full pan', () => {
    const top = zoomedCrop(cover, 1, 0, -1);
    const bottom = zoomedCrop(cover, 1, 0, 1);
    expect(top.offset[1]).toBeCloseTo(0);
    expect(bottom.offset[1] + bottom.scale[1]).toBeCloseTo(1);
  });

  it('never zooms out and never pans past the edge', () => {
    expect(zoomedCrop(cover, 0.5, 0, 0).scale).toEqual(cover.scale);
    expect(zoomedCrop(cover, 1, 0, 9).offset[1]).toBeCloseTo(zoomedCrop(cover, 1, 0, 1).offset[1]);
  });
});

describe('sourceRefs', () => {
  const pts = Float64Array.from([0, 0.1, 0.2, 0.3]);

  it('picks the nearest real frame, never a blend', () => {
    const refs = sourceRefs([0, 0.04, 0.06, 0.16, 0.26], pts);
    expect(refs.map((r) => r.a)).toEqual([0, 0, 1, 2, 3]);
    expect(refs.every((r) => r.b === null && r.alpha === 0)).toBe(true);
  });

  it('holds the last frame past the end and the first before the start', () => {
    expect(sourceRefs([-1, 5], pts).map((r) => r.a)).toEqual([0, 3]);
    expect(sourceRefs([0, 1], new Float64Array())).toEqual([]);
  });

  it('keeps the requested time, so the player can follow the plan', () => {
    expect(sourceRefs([0.12], pts)[0]!.t).toBe(0.12);
  });
});

describe('easeInOut', () => {
  it('runs 0 to 1 and stays inside it', () => {
    expect([easeInOut(-1), easeInOut(0), easeInOut(0.5), easeInOut(1), easeInOut(2)]).toEqual([0, 0, 0.5, 1, 1]);
  });
});
