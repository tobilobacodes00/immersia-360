import { describe, expect, it } from 'vitest';
import { DISPLAY_ITEM_LIMIT, type DisplayItem } from '@immersia/shared';
import {
  advanceDelayMs,
  cacheWanted,
  columnItems,
  currentItem,
  dwellMs,
  fillFor,
  hasWaitingArrival,
  hashtagLabel,
  initialPlayer,
  isJustIn,
  itemDurationMs,
  mediaKey,
  mosaicPlan,
  mosaicTiles,
  orderItems,
  playerReducer,
  stripItems,
  type PlayerAction,
  type PlayerState,
} from './playback';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (s: number) => new Date(Date.UTC(2026, 9, 19, 12, 0, s)).toISOString();

/** Item `n` was put on screen `n` seconds into the hour: a bigger n is newer. */
const item = (n: number, media: Partial<DisplayItem['media']> = {}): DisplayItem => ({
  id: uuid(n),
  booth: 'video360',
  shortCode: 'ABC234',
  link: `https://example.com/s/${n}`,
  media: { type: 'video', url: `/api/live/media/${uuid(n)}?e=1&s=x`, poster: null, width: 720, height: 1280, ...media },
  at: at(n),
});

const run = (state: PlayerState, ...actions: PlayerAction[]) => actions.reduce(playerReducer, state);
const feed = (...ns: number[]): PlayerAction => ({ type: 'items', items: ns.map((n) => item(n)) });
const now = (state: PlayerState) => currentItem(state)?.id;
/** The ids shown over `count` advances. */
function shown(state: PlayerState, count: number) {
  const out: (string | undefined)[] = [];
  for (let i = 0; i < count; i++) {
    state = playerReducer(state, { type: 'advance' });
    out.push(now(state));
  }
  return out;
}

describe('dwell time (LIV-10)', () => {
  it('stays within 3 to 15 seconds', () => {
    expect(dwellMs(8)).toBe(8000);
    expect(dwellMs(1)).toBe(3000);
    expect(dwellMs(60)).toBe(15_000);
    expect(dwellMs(Number.NaN)).toBe(8000);
  });

  it('keeps a video for its own length when that is longer than the dwell, up to three dwells', () => {
    const video = item(1);
    expect(itemDurationMs(video, 8, 5)).toBe(8000);
    expect(itemDurationMs(video, 8, 11.5)).toBe(11_500);
    expect(itemDurationMs(video, 8, 40)).toBe(24_000);
    expect(itemDurationMs(video, 3, 40)).toBe(9000);
  });

  it('uses the dwell while a video length is unknown, and for photos and GIFs', () => {
    expect(itemDurationMs(item(1), 8, null)).toBe(8000);
    expect(itemDurationMs(item(1), 8, Number.NaN)).toBe(8000);
    expect(itemDurationMs(item(1, { type: 'gif' }), 8, 30)).toBe(8000);
    expect(itemDurationMs(item(1, { type: 'image' }), 8, 30)).toBe(8000);
  });

  it('cuts the item on screen to its minimum when an arrival is waiting, never below it', () => {
    expect(advanceDelayMs({ durationMs: 8000, elapsedMs: 1000, jump: false })).toBe(7000);
    expect(advanceDelayMs({ durationMs: 8000, elapsedMs: 1000, jump: true })).toBe(2000);
    expect(advanceDelayMs({ durationMs: 8000, elapsedMs: 5000, jump: true })).toBe(0);
    expect(advanceDelayMs({ durationMs: 8000, elapsedMs: 9000, jump: false })).toBe(0);
  });
});

describe('the rotation (LIV-2)', () => {
  it('orders newest first, stamps tied by id', () => {
    const tied1 = { ...item(1), at: at(5) };
    const tied2 = { ...item(2), at: at(5) };
    expect(orderItems([item(3), tied1, tied2]).map((i) => i.id)).toEqual([uuid(2), uuid(1), uuid(3)]);
  });

  it('starts on the newest item and walks to older ones, then round', () => {
    const state = run(initialPlayer, feed(1, 2, 3));
    expect(now(state)).toBe(uuid(3));
    expect(shown(state, 4)).toEqual([uuid(2), uuid(1), uuid(3), uuid(2)]);
  });

  it('shows nothing, and does not fail, until there are items', () => {
    const empty = run(initialPlayer, feed());
    expect(empty.ready).toBe(true);
    expect(currentItem(empty)).toBeNull();
    expect(currentItem(playerReducer(empty, { type: 'advance' }))).toBeNull();
    expect(now(playerReducer(empty, feed(1)))).toBe(uuid(1));
  });

  it('treats the first list as the baseline: nothing in it is an arrival', () => {
    const state = run(initialPlayer, feed(1, 2, 3));
    expect(state.queue).toEqual([]);
    expect(state.fresh).toEqual([]);
  });

  it('a new arrival plays next, then the rotation resumes where it was', () => {
    let state = run(initialPlayer, feed(1, 2, 3, 4)); // on 4; the rotation is at 4
    state = run(state, { type: 'advance' }); // on 3
    state = run(state, feed(1, 2, 3, 4, 5)); // 5 arrives while 3 is on screen
    expect(now(state)).toBe(uuid(3)); // the item on screen is not replaced at once
    expect(state.queue).toEqual([uuid(5)]);
    expect(shown(state, 4)).toEqual([uuid(5), uuid(2), uuid(1), uuid(5)]);
  });

  it('several arrivals play newest first before the rotation resumes', () => {
    let state = run(initialPlayer, feed(1, 2, 3)); // on 3
    state = run(state, feed(1, 2, 3, 4, 5, 6));
    expect(shown(state, 5)).toEqual([uuid(6), uuid(5), uuid(4), uuid(2), uuid(1)]);
  });

  it('knows an arrival came off the queue, and that the rotation did not', () => {
    let state = run(initialPlayer, feed(1, 2), feed(1, 2, 3));
    expect(state.currentFresh).toBe(false);
    state = run(state, { type: 'advance' });
    expect(state.currentFresh).toBe(true);
    expect(now(state)).toBe(uuid(3));
    expect(run(state, { type: 'advance' }).currentFresh).toBe(false);
  });

  it('does not show the same item twice in a row after the loop wraps onto an arrival', () => {
    let state = run(initialPlayer, feed(1, 2)); // on 2
    state = run(state, { type: 'advance' }); // on 1: the end of the loop
    state = run(state, feed(1, 2, 3), { type: 'advance' }); // 3 arrives and plays
    expect(now(state)).toBe(uuid(3));
    // The wrap would land on 3 again; it moves on to 2.
    expect(now(run(state, { type: 'advance' }))).toBe(uuid(2));
  });

  it('a lone item plays again, as a new play', () => {
    const state = run(initialPlayer, feed(1));
    const again = playerReducer(state, { type: 'advance' });
    expect(now(again)).toBe(uuid(1));
    expect(again.playId).toBeGreaterThan(state.playId);
  });

  it('takes an item off the screen at once when it is removed or opted out (LIV-8)', () => {
    let state = run(initialPlayer, feed(1, 2, 3)); // on 3
    state = run(state, feed(1, 2));
    expect(now(state)).toBe(uuid(2));
    expect(run(state, feed(), { type: 'advance' }).currentId).toBeNull();
  });

  it('knows when an arrival is waiting, unless its media failed', () => {
    let state = run(initialPlayer, feed(1, 2));
    expect(hasWaitingArrival(state)).toBe(false);
    state = run(state, feed(1, 2, 3));
    expect(hasWaitingArrival(state)).toBe(true);
    expect(hasWaitingArrival(run(state, { type: 'failed', id: uuid(3) }))).toBe(false);
    expect(hasWaitingArrival(run(state, { type: 'advance' }))).toBe(false);
  });

  it('forgets a removed item, so it returns as an arrival if approved again', () => {
    const state = run(initialPlayer, feed(1, 2, 3), feed(1, 2), feed(1, 2, 3));
    expect(state.queue).toEqual([uuid(3)]);
  });

  it('ignores a list it has already seen', () => {
    const items = [item(1), item(2)];
    const once = run(initialPlayer, { type: 'items', items });
    expect(playerReducer(once, { type: 'items', items })).toBe(once);
  });

  it('keeps going when the order is shuffled by a refreshed timestamp', () => {
    let state = run(initialPlayer, feed(1, 2, 3)); // on 3
    // 1 is approved again and is now the newest, but it is not an arrival: it was already known.
    state = run(state, { type: 'items', items: [{ ...item(1), at: at(9) }, item(2), item(3)] });
    expect(state.queue).toEqual([]);
    expect(now(state)).toBe(uuid(3));
  });
});

describe('items that will not load (LIV-12)', () => {
  it('skips an item whose media failed, and retries it later', () => {
    let state = run(initialPlayer, feed(1, 2, 3)); // on 3
    state = run(state, { type: 'failed', id: uuid(3) });
    expect(now(state)).toBe(uuid(2)); // the failed item on screen is replaced
    expect(shown(state, 3)).toEqual([uuid(1), uuid(2), uuid(1)]); // 3 never comes round
    state = run(state, { type: 'retry' });
    expect(shown(state, 3)).toContain(uuid(3));
  });

  it('shows nothing, not an error, when every item failed', () => {
    let state = run(initialPlayer, feed(1, 2)); // on 2
    state = run(state, { type: 'failed', id: uuid(2) }, { type: 'failed', id: uuid(1) });
    expect(currentItem(state)).toBeNull();
    expect(now(run(state, { type: 'retry' }))).toBeDefined();
  });

  it('tries an item again when its media address changes', () => {
    let state = run(initialPlayer, feed(1)); // on 1
    state = run(state, { type: 'failed', id: uuid(1) });
    expect(currentItem(state)).toBeNull();
    state = run(state, { type: 'items', items: [item(1, { url: '/api/live/media/other?e=2&s=y' })] });
    expect(now(state)).toBe(uuid(1));
  });
});

describe('just in (LIV-3 Ticker)', () => {
  it('badges arrivals among the newest items, never the baseline', () => {
    let state = run(initialPlayer, feed(1, 2, 3));
    expect(isJustIn(state, uuid(3))).toBe(false);
    state = run(state, feed(1, 2, 3, 4));
    expect(isJustIn(state, uuid(4))).toBe(true);
    expect(isJustIn(state, uuid(3))).toBe(false);
  });

  it('drops the badge when an arrival is no longer among the newest, or has cooled', () => {
    let state = run(initialPlayer, feed(1), feed(1, 2));
    expect(isJustIn(state, uuid(2))).toBe(true);
    expect(isJustIn(run(state, feed(1, 2, 3, 4, 5)), uuid(2))).toBe(false);
    state = run(state, { type: 'cool' });
    expect(isJustIn(state, uuid(2))).toBe(false);
  });
});

describe('vertical media on a landscape screen (LIV-6)', () => {
  const tv = { w: 1920, h: 1080 };

  it('fills the stage when the shapes match', () => {
    expect(fillFor({ width: 1920, height: 1080 }, tv, 'blur')).toEqual({ kind: 'cover' });
    expect(fillFor({ width: 1800, height: 1080 }, tv, 'columns')).toEqual({ kind: 'cover' });
  });

  it('centres a 9:16 video over a blurred copy of itself', () => {
    expect(fillFor({ width: 1080, height: 1920 }, tv, 'blur')).toEqual({ kind: 'blur' });
  });

  it('repeats neighbours side by side when columns are chosen', () => {
    expect(fillFor({ width: 1080, height: 1920 }, tv, 'columns')).toEqual({ kind: 'columns', count: 3 });
    // A very tall photo strip fits more columns, up to five.
    expect(fillFor({ width: 600, height: 1800 }, tv, 'columns')).toEqual({ kind: 'columns', count: 5 });
  });

  it('falls back to blur where one column would be all that fits, and for wide media', () => {
    expect(fillFor({ width: 1620, height: 1080 }, tv, 'columns')).toEqual({ kind: 'blur' });
    expect(fillFor({ width: 2560, height: 1080 }, tv, 'columns')).toEqual({ kind: 'blur' });
  });

  it('covers until the stage has been measured', () => {
    expect(fillFor({ width: 1080, height: 1920 }, { w: 0, h: 0 }, 'blur')).toEqual({ kind: 'cover' });
  });

  it('lays neighbours either side of the current item, wrapping, and repeating a lone item', () => {
    const items = [item(5), item(4), item(3), item(2), item(1)];
    const ids = (current: number, count: number) => columnItems(items, uuid(current), count).map((i) => i.id);
    expect(ids(4, 3)).toEqual([uuid(5), uuid(4), uuid(3)]);
    expect(ids(5, 3)).toEqual([uuid(1), uuid(5), uuid(4)]);
    expect(ids(1, 3)).toEqual([uuid(2), uuid(1), uuid(5)]);
    expect(ids(3, 5)).toEqual([uuid(5), uuid(4), uuid(3), uuid(2), uuid(1)]);
    expect(columnItems([item(1)], uuid(1), 3).map((i) => i.id)).toEqual([uuid(1), uuid(1), uuid(1)]);
    expect(columnItems([], uuid(1), 3)).toEqual([]);
  });
});

describe('the mosaic (LIV-3)', () => {
  it('shows six to twelve items in a grid that is always full', () => {
    const total = (n: number, portrait = false) => {
      const plan = mosaicPlan(n, portrait);
      return { items: plan.tiles + 1, cells: plan.columns.match(/\d+/)![0] + 'x' + plan.rows.match(/\d+/)![0] };
    };
    expect(total(6)).toEqual({ items: 6, cells: '3x3' });
    expect(total(8)).toEqual({ items: 6, cells: '3x3' });
    expect(total(9)).toEqual({ items: 9, cells: '4x3' });
    expect(total(11)).toEqual({ items: 9, cells: '4x3' });
    expect(total(12)).toEqual({ items: 12, cells: '5x3' });
    expect(total(DISPLAY_ITEM_LIMIT)).toEqual({ items: 12, cells: '5x3' });
    expect(total(12, true)).toEqual({ items: 12, cells: '3x5' });
  });

  it('puts the enlarged tile over 2x2 cells of the grid', () => {
    expect(mosaicPlan(12, false)).toMatchObject({ bigColumns: 2, bigRows: 2, tiles: 11 });
  });

  it('sets the enlarged item beside a single column when there are fewer than six', () => {
    expect(mosaicPlan(1, false)).toMatchObject({ tiles: 0, bigColumns: 1, bigRows: 1 });
    expect(mosaicPlan(4, false)).toMatchObject({ tiles: 3, bigColumns: 1, bigRows: 3 });
    expect(mosaicPlan(4, true)).toMatchObject({ tiles: 3, bigColumns: 3, bigRows: 1 });
  });

  it('fills the tiles with the newest items other than the enlarged one', () => {
    const items = orderItems([1, 2, 3, 4, 5, 6].map((n) => item(n)));
    expect(mosaicTiles(items, uuid(6), 3).map((i) => i.id)).toEqual([uuid(5), uuid(4), uuid(3)]);
    expect(mosaicTiles(items, uuid(2), 3).map((i) => i.id)).toEqual([uuid(6), uuid(5), uuid(4)]);
    expect(mosaicTiles(items, null, 2)).toHaveLength(2);
  });

  it('takes the newest items for the Ticker strip', () => {
    const items = orderItems(Array.from({ length: 20 }, (_, n) => item(n + 1)));
    expect(stripItems(items)).toHaveLength(8);
    expect(stripItems(items)[0]!.id).toBe(uuid(20));
    expect(stripItems(items, 3)).toHaveLength(3);
  });
});

describe('hashtags', () => {
  it('shows one leading #, or nothing', () => {
    expect(hashtagLabel('JoyAndTunde2026')).toBe('#JoyAndTunde2026');
    expect(hashtagLabel('##JoyAndTunde')).toBe('#JoyAndTunde');
    expect(hashtagLabel(' Golden Hour ')).toBe('#GoldenHour');
    expect(hashtagLabel('')).toBeNull();
    expect(hashtagLabel(' # ')).toBeNull();
  });
});

describe('offline media (LIV-12)', () => {
  const base = 'https://tv.example/tv/live';

  it('keys media by its address without the query string, so rotating signed links hit the same entry', () => {
    expect(mediaKey('/api/live/media/abc?e=1&s=x', base)).toBe('https://tv.example/api/live/media/abc');
    expect(mediaKey('/api/live/media/abc?e=2&s=y', base)).toBe('https://tv.example/api/live/media/abc');
    expect(mediaKey('https://files.example/bucket/key.mp4?X-Amz-Signature=1#t=2', base)).toBe(
      'https://files.example/bucket/key.mp4',
    );
  });

  it('wants the event files first, then the newest items, once each', () => {
    const items = [item(1), item(2), item(3)];
    const wanted = cacheWanted(
      items,
      ['https://files.example/logo.png?sig=1', null, undefined],
      base,
      DISPLAY_ITEM_LIMIT,
    );
    expect(wanted.map((w) => w.key)).toEqual([
      'https://files.example/logo.png',
      `https://tv.example/api/live/media/${uuid(3)}`,
      `https://tv.example/api/live/media/${uuid(2)}`,
      `https://tv.example/api/live/media/${uuid(1)}`,
    ]);
    // The same file under a rotated link is not wanted twice.
    expect(
      cacheWanted(
        items,
        ['https://files.example/logo.png?a', 'https://files.example/logo.png?b'],
        base,
        DISPLAY_ITEM_LIMIT,
      ),
    ).toHaveLength(4);
  });

  it('keeps at most the newest 200 items', () => {
    const items = Array.from({ length: DISPLAY_ITEM_LIMIT + 30 }, (_, n) => item(n + 1));
    const wanted = cacheWanted(items, [], base, DISPLAY_ITEM_LIMIT);
    expect(wanted).toHaveLength(DISPLAY_ITEM_LIMIT);
    expect(wanted[0]!.key).toBe(`https://tv.example/api/live/media/${uuid(DISPLAY_ITEM_LIMIT + 30)}`);
    expect(wanted.at(-1)!.key).toBe(`https://tv.example/api/live/media/${uuid(31)}`);
    expect(cacheWanted(items, [], base, 5)).toHaveLength(5);
  });
});
