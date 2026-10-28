import { describe, expect, it } from 'vitest';
import {
  BOOTH_END_CARD_S,
  CARD_SAFETY_S,
  boothCardSeconds,
  candidatesFor,
  engagement,
  highlightPlanSchema,
  highlightUploadSchema,
  pickReelMedia,
  selectHighlights,
  type HighlightCandidate,
  type ReelOutputRow,
} from './highlights-core';

const MIN = 60_000;
const cand = (n: number, patch: Partial<HighlightCandidate> = {}): HighlightCandidate => ({
  id: `s${String(n).padStart(3, '0')}`,
  capturedAt: Date.UTC(2026, 9, 24, 18) + n * MIN,
  booth: 'video360',
  downloads: 0,
  displayScans: 0,
  views: 0,
  ...patch,
});
const many = (n: number, make: (i: number) => HighlightCandidate = cand) =>
  Array.from({ length: n }, (_, i) => make(i));
const ids = (picked: { id: string }[]) => picked.map((p) => p.id);

describe('engagement', () => {
  it('counts a download for more than a scan of the display QR, and a scan for more than a look', () => {
    expect(engagement({ downloads: 1, displayScans: 0, views: 0 })).toBeGreaterThan(
      engagement({ downloads: 0, displayScans: 1, views: 0 }),
    );
    expect(engagement({ downloads: 0, displayScans: 1, views: 0 })).toBeGreaterThan(
      engagement({ downloads: 0, displayScans: 0, views: 1 }),
    );
    expect(engagement({ downloads: 2, displayScans: 3, views: 5 })).toBe(2 * 3 + 3 * 2 + 5);
  });
});

describe('selectHighlights: quality', () => {
  it('prefers what guests downloaded, scanned and opened', () => {
    const candidates = many(40, (i) =>
      cand(i, { downloads: i === 7 ? 4 : 0, displayScans: i === 21 ? 3 : 0, views: i === 33 ? 2 : 0 }),
    );
    const picked = ids(selectHighlights(candidates, 3));
    expect(picked[0]).toBe('s007');
    expect(picked.sort()).toEqual(['s007', 's021', 's033']);
  });

  it('leads with the best, and the weights fall from 1', () => {
    const candidates = many(10, (i) => cand(i * 10, { downloads: i }));
    const picked = selectHighlights(candidates, 4);
    expect(picked[0]!.score).toBe(9 * 3);
    expect(picked[0]!.weight).toBe(1);
    picked.slice(1).forEach((p, i) => expect(p.weight).toBeLessThan(picked[i]!.weight));
    expect(picked.at(-1)!.weight).toBeGreaterThan(0);
  });

  it('does not let one runaway item drown the rest', () => {
    const candidates = many(30, (i) => cand(i * 5, { downloads: i === 0 ? 5000 : i % 4 === 0 ? 2 : 0 }));
    const picked = ids(selectHighlights(candidates, 6));
    expect(picked[0]).toBe('s000');
    // The others are still the ones with something to show for themselves, not arbitrary.
    expect(picked.slice(1).filter((id) => Number(id.slice(1)) % 20 === 0).length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to the newest first when nothing has earned anything', () => {
    const picked = ids(selectHighlights(many(50), 5));
    expect(picked[0]).toBe('s049');
    expect(picked).toHaveLength(5);
  });

  it('is repeatable: the same gallery gives the same reel, whatever order it arrives in', () => {
    const candidates = many(60, (i) => cand(i, { views: i % 7 }));
    const reversed = [...candidates].reverse();
    expect(ids(selectHighlights(reversed, 12))).toEqual(ids(selectHighlights(candidates, 12)));
  });

  it('breaks ties towards the newer capture, then the lower id', () => {
    const a = cand(0, { id: 'b', capturedAt: 1000 });
    const b = cand(0, { id: 'a', capturedAt: 1000 });
    expect(ids(selectHighlights([a, b], 2))).toEqual(['a', 'b']);
  });
});

describe('selectHighlights: variety', () => {
  it('covers both booths when an event runs both', () => {
    const candidates = many(60, (i) => cand(i, { booth: i % 6 === 0 ? 'photo' : 'video360', views: 1 }));
    const picked = selectHighlights(candidates, 12);
    const photo = picked.filter((p) => candidates.find((c) => c.id === p.id)!.booth === 'photo').length;
    expect(photo).toBeGreaterThanOrEqual(2);
    expect(photo).toBeLessThan(12);
  });

  it('does not take a whole block of the busiest quarter hour', () => {
    // 100 captures over 5 hours; the 15 minutes from 02:00 are by far the most engaged.
    const candidates = many(100, (i) => cand(i * 3, { views: i >= 40 && i < 45 ? 9 : i % 5 === 0 ? 1 : 0 }));
    const picked = selectHighlights(candidates, 10).map((p) => candidates.find((c) => c.id === p.id)!.capturedAt);
    const busy = picked.filter((t) => t >= candidates[40]!.capturedAt && t <= candidates[44]!.capturedAt).length;
    expect(busy).toBeLessThanOrEqual(2);
    // …and they span the event, not just one end of it.
    expect(Math.max(...picked) - Math.min(...picked)).toBeGreaterThan(
      0.5 * (candidates.at(-1)!.capturedAt - candidates[0]!.capturedAt),
    );
  });

  it('spreads a reel with no signals across the whole event, still leaning to the newest', () => {
    const candidates = many(200);
    const picked = selectHighlights(candidates, 10).map((p) => Number(p.id.slice(1)));
    expect(Math.min(...picked)).toBeLessThan(60);
    expect(Math.max(...picked)).toBeGreaterThan(190);
    expect(picked[0]).toBe(199);
  });

  it('is the whole list when asked for more than there is, and nothing for nothing', () => {
    expect(selectHighlights(many(4), 10)).toHaveLength(4);
    expect(selectHighlights([], 5)).toEqual([]);
    expect(selectHighlights(many(4), 0)).toEqual([]);
    expect(selectHighlights(many(1), 1)[0]!.weight).toBe(1);
  });
});

describe('candidatesFor', () => {
  it('hands over enough for the length, with spares, and never an unbounded list', () => {
    expect(candidatesFor(30)).toBeGreaterThanOrEqual(15);
    expect(candidatesFor(60)).toBeGreaterThan(candidatesFor(30));
    expect(candidatesFor(90)).toBeLessThanOrEqual(48);
  });
});

describe('pickReelMedia', () => {
  const row = (kind: string, patch: Partial<ReelOutputRow> = {}): ReelOutputRow => ({
    id: `o-${kind}`,
    kind,
    key: `k/${kind}`,
    width: 1080,
    height: 1920,
    durationMs: 8000,
    bytes: 1000,
    ...patch,
  });

  it('uses a 360 booth session’s video: the full one at 1080p, the light copy at 720p', () => {
    const outputs = [row('mp4'), row('small_mp4'), row('poster')];
    expect(pickReelMedia(outputs, '1080p')).toMatchObject({
      kind: 'video',
      booth: 'video360',
      output: { id: 'o-mp4' },
    });
    expect(pickReelMedia(outputs, '720p')).toMatchObject({ kind: 'video', output: { id: 'o-small_mp4' } });
  });

  it('falls back to the other copy when only one exists', () => {
    expect(pickReelMedia([row('mp4')], '720p')!.output.id).toBe('o-mp4');
    expect(pickReelMedia([row('small_mp4')], '1080p')!.output.id).toBe('o-small_mp4');
  });

  it('shows a photo strip as a still', () => {
    expect(pickReelMedia([row('strip'), row('gif'), row('boomerang')], '1080p')).toMatchObject({
      kind: 'still',
      booth: 'photo',
      output: { id: 'o-strip' },
    });
  });

  it('plays a photo session’s boomerang when it has no strip, and leaves out a GIF-only one', () => {
    expect(pickReelMedia([row('gif'), row('boomerang')], '1080p')).toMatchObject({ kind: 'video', booth: 'photo' });
    expect(pickReelMedia([row('gif'), row('short_video')], '1080p')).toMatchObject({ kind: 'video' });
    expect(pickReelMedia([row('gif')], '1080p')).toBeNull();
  });

  it('ignores files that are not ready or have no size', () => {
    expect(pickReelMedia([row('mp4', { key: null })], '1080p')).toBeNull();
    expect(pickReelMedia([row('mp4', { width: null })], '1080p')).toBeNull();
    expect(pickReelMedia([row('mp4', { key: null }), row('small_mp4')], '1080p')!.output.id).toBe('o-small_mp4');
    expect(pickReelMedia([], '1080p')).toBeNull();
  });
});

describe('boothCardSeconds', () => {
  const video = { introAssetId: 'intro', outroAssetId: 'outro', cardSeconds: 2 };
  const assets = new Map([
    ['intro', { mime: 'image/png', durationMs: null }],
    ['outro', { mime: 'video/mp4', durationMs: 1500 }],
  ]);

  it('is nothing for an event without cards', () => {
    expect(boothCardSeconds({ ...video, introAssetId: null, outroAssetId: null }, assets, false)).toEqual({
      headS: 0,
      tailS: 0,
    });
  });

  it('counts a picture card at the card length and a clip at its own length', () => {
    const { headS, tailS } = boothCardSeconds(video, assets, false);
    expect(headS).toBeCloseTo(2 + CARD_SAFETY_S);
    expect(tailS).toBeCloseTo(1.5 + CARD_SAFETY_S);
  });

  it('caps a long clip at the card length', () => {
    const long = new Map([['outro', { mime: 'video/mp4', durationMs: 9000 }]]);
    expect(boothCardSeconds({ ...video, introAssetId: null }, long, false).tailS).toBeCloseTo(2 + CARD_SAFETY_S);
  });

  it('adds the QR end card to the end', () => {
    expect(boothCardSeconds({ ...video, introAssetId: null, outroAssetId: null }, assets, true)).toEqual({
      headS: 0,
      tailS: BOOTH_END_CARD_S + CARD_SAFETY_S,
    });
    expect(boothCardSeconds(video, assets, true).tailS).toBeCloseTo(1.5 + BOOTH_END_CARD_S + CARD_SAFETY_S);
  });

  it('skips a card whose asset has been deleted: it was never drawn', () => {
    expect(boothCardSeconds(video, new Map(), false)).toEqual({ headS: 0, tailS: 0 });
  });
});

describe('request schemas', () => {
  it('accepts the three lengths and two qualities only', () => {
    expect(highlightPlanSchema.safeParse({ lengthS: 60, quality: '1080p' }).success).toBe(true);
    expect(highlightPlanSchema.safeParse({ lengthS: 45, quality: '1080p' }).success).toBe(false);
    expect(highlightPlanSchema.safeParse({ lengthS: 30, quality: '4k' }).success).toBe(false);
  });

  it('bounds an upload: size, length, number of sessions and their ids', () => {
    const ok = {
      bytes: 50_000_000,
      width: 1080,
      height: 1920,
      durationMs: 60_000,
      sessionIds: ['0190d6f2-7b1a-7cc2-8f55-6f1d9e6e3a10'],
      posterBytes: 40_000,
    };
    expect(highlightUploadSchema.safeParse(ok).success).toBe(true);
    expect(highlightUploadSchema.safeParse({ ...ok, posterBytes: null }).success).toBe(true);
    expect(highlightUploadSchema.safeParse({ ...ok, bytes: 5 * 1024 ** 3 }).success).toBe(false);
    expect(highlightUploadSchema.safeParse({ ...ok, durationMs: 600_000 }).success).toBe(false);
    expect(highlightUploadSchema.safeParse({ ...ok, sessionIds: [] }).success).toBe(false);
    expect(highlightUploadSchema.safeParse({ ...ok, sessionIds: ['nope'] }).success).toBe(false);
  });
});
