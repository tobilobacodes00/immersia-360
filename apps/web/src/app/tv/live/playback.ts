import type { DisplayConfig, DisplayItem } from '@immersia/shared';

/**
 * The rules of the Live Display, kept free of React and the DOM so they can be tested: which item
 * plays next (LIV-2), how long it stays (LIV-10), how vertical media fills a landscape screen
 * (LIV-6), the mosaic's shape (LIV-3) and which media bytes a screen keeps (LIV-12).
 */

// -----------------------------------------------------------------------------------------------
// Dwell time

export const DWELL_MIN_S = 3;
export const DWELL_MAX_S = 15;
const DEFAULT_DWELL_S = 8;
/** A video plays through its own length, but never longer than this many dwells. */
export const VIDEO_DWELL_CAP = 3;
/** An item is always on screen at least this long, even when a new arrival is waiting. */
export const MIN_SHOW_MS = DWELL_MIN_S * 1000;

export function dwellMs(seconds: number): number {
  const s = Number.isFinite(seconds) ? seconds : DEFAULT_DWELL_S;
  return Math.round(Math.min(DWELL_MAX_S, Math.max(DWELL_MIN_S, s)) * 1000);
}

/**
 * How long an item stays: the dwell, or for a video its own length when that is longer, capped at
 * three dwells. `videoSeconds` is what the player reports once the file's metadata has loaded.
 */
export function itemDurationMs(
  item: Pick<DisplayItem, 'media'>,
  dwellSeconds: number,
  videoSeconds: number | null,
): number {
  const dwell = dwellMs(dwellSeconds);
  if (item.media.type !== 'video' || videoSeconds === null || !Number.isFinite(videoSeconds) || videoSeconds <= 0)
    return dwell;
  return Math.min(Math.max(Math.round(videoSeconds * 1000), dwell), dwell * VIDEO_DWELL_CAP);
}

/**
 * Time left before the next item. When a new arrival is waiting (`jump`), the item on screen is cut
 * down to its minimum, so a guest standing at the screen sees their moment within seconds (LIV-2)
 * without anything being shown for less than the shortest dwell.
 */
export function advanceDelayMs({
  durationMs,
  elapsedMs,
  jump,
}: {
  durationMs: number;
  elapsedMs: number;
  jump: boolean;
}): number {
  const end = jump ? Math.min(durationMs, MIN_SHOW_MS) : durationMs;
  return Math.max(0, end - elapsedMs);
}

// -----------------------------------------------------------------------------------------------
// The playlist

type Stamp = Pick<DisplayItem, 'id' | 'at'>;

/** Newest first; items stamped the same instant fall back to their id so the order is total. */
export const isNewer = (a: Stamp, b: Stamp) => a.at > b.at || (a.at === b.at && a.id > b.id);

export function orderItems(items: readonly DisplayItem[]): DisplayItem[] {
  return [...items].sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0));
}

/** How long "just in" stays on an arrival after the last one (the player clears it on a timer). */
export const JUST_IN_MS = 2 * 60_000;
/** Only the newest items can be "just in". */
export const JUST_IN_RANK = 3;

export interface PlayerState {
  /** False until the first feed has been seen: that first list is the baseline, not news. */
  ready: boolean;
  /** The list the state was last built from, so a render can tell whether it has seen it. */
  source: readonly DisplayItem[] | null;
  /** Newest first. */
  items: DisplayItem[];
  /** Everything in the last list: an id outside it that turns up is an arrival. */
  known: ReadonlySet<string>;
  /** Arrivals not shown yet, newest first: they play before the rotation resumes. */
  queue: string[];
  /** Arrivals of this session that count as "just in". */
  fresh: string[];
  /** Where the rotation is. It is a position, not an id, so it survives the item being removed. */
  cursor: Stamp | null;
  currentId: string | null;
  /** The item on screen came off the queue (it may not be cut short by another arrival). */
  currentFresh: boolean;
  /** Counts every pick, so showing the same item again (a lone item loops) still starts a new play. */
  playId: number;
  /** Items whose media would not load, by the URL that failed: skipped until retried. */
  failed: Record<string, string>;
}

export type PlayerAction =
  | { type: 'items'; items: readonly DisplayItem[] }
  | { type: 'advance' }
  | { type: 'failed'; id: string }
  | { type: 'retry' }
  | { type: 'cool' };

export const initialPlayer: PlayerState = {
  ready: false,
  source: null,
  items: [],
  known: new Set(),
  queue: [],
  fresh: [],
  cursor: null,
  currentId: null,
  currentFresh: false,
  playId: 0,
  failed: {},
};

/** Choose the next item: the newest arrival first, otherwise the rotation, newest to oldest and round. */
function pick(state: PlayerState): PlayerState {
  const { items, queue, failed, cursor } = state;
  const eligible = items.filter((i) => failed[i.id] !== i.media.url);
  const arrival = eligible.find((i) => queue.includes(i.id));
  if (arrival)
    return {
      ...state,
      queue: queue.filter((id) => id !== arrival.id),
      currentId: arrival.id,
      currentFresh: true,
      playId: state.playId + 1,
    };
  if (!eligible.length) return { ...state, currentId: null, currentFresh: false, playId: state.playId + 1 };

  const rotation = cursor
    ? [...eligible.filter((i) => isNewer(cursor, i)), ...eligible.filter((i) => !isNewer(cursor, i))]
    : eligible;
  // Never the same item twice running, unless it is the only one.
  const next = rotation.find((i) => i.id !== state.currentId) ?? rotation[0]!;
  return {
    ...state,
    cursor: { id: next.id, at: next.at },
    currentId: next.id,
    currentFresh: false,
    playId: state.playId + 1,
  };
}

/** Keep what is on screen if it is still there; otherwise (removed, opted out, or nothing yet) pick. */
function settle(state: PlayerState): PlayerState {
  if (state.currentId !== null && state.items.some((i) => i.id === state.currentId)) return state;
  if (state.currentId === null && !state.items.length) return state;
  return pick(state);
}

function ingest(state: PlayerState, source: readonly DisplayItem[]): PlayerState {
  if (source === state.source) return state;
  const items = orderItems(source);
  const ids = new Set(items.map((i) => i.id));
  if (!state.ready) return settle({ ...state, ready: true, source, items, known: ids });

  const arrived = new Set(items.filter((i) => !state.known.has(i.id)).map((i) => i.id));
  const keep = (list: readonly string[]) =>
    items.filter((i) => arrived.has(i.id) || list.includes(i.id)).map((i) => i.id);
  const failed = Object.fromEntries(Object.entries(state.failed).filter(([id]) => ids.has(id)));
  return settle({ ...state, source, items, known: ids, queue: keep(state.queue), fresh: keep(state.fresh), failed });
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'items':
      return ingest(state, action.items);
    case 'advance':
      return state.ready ? pick(state) : state;
    case 'failed': {
      const item = state.items.find((i) => i.id === action.id);
      if (!item || state.failed[item.id] === item.media.url) return state;
      const next = { ...state, failed: { ...state.failed, [item.id]: item.media.url } };
      return state.currentId === item.id ? pick(next) : next;
    }
    case 'retry':
      return Object.keys(state.failed).length ? settle({ ...state, failed: {} }) : state;
    case 'cool':
      return state.fresh.length ? { ...state, fresh: [] } : state;
  }
}

export const currentItem = (state: PlayerState): DisplayItem | null =>
  state.items.find((i) => i.id === state.currentId) ?? null;

/** A new arrival is waiting to be shown (and can be: its media has not failed). */
export const hasWaitingArrival = (state: PlayerState): boolean =>
  state.items.some((i) => state.queue.includes(i.id) && state.failed[i.id] !== i.media.url);

/** LIV-3 Ticker: a recent arrival among the newest items wears the "just in" badge. */
export function isJustIn(state: PlayerState, id: string): boolean {
  const rank = state.items.findIndex((i) => i.id === id);
  return rank >= 0 && rank < JUST_IN_RANK && state.fresh.includes(id);
}

// -----------------------------------------------------------------------------------------------
// LIV-6: vertical media on a landscape screen

export type Fill = { kind: 'cover' } | { kind: 'blur' } | { kind: 'columns'; count: number };

/** Within this much of the stage's own shape, the media simply fills it (a sliver is cropped). */
const FIT_TOLERANCE = 0.1;
const MAX_COLUMNS = 5;

/**
 * How media of a given shape fills a stage of another: `blur` centres it over a blurred copy of
 * itself; `columns` repeats neighbouring items side by side, when at least two columns fit.
 */
export function fillFor(
  media: { width: number; height: number },
  stage: { w: number; h: number },
  preference: DisplayConfig['settings']['verticalFill'],
): Fill {
  if (!stage.w || !stage.h || !media.width || !media.height) return { kind: 'cover' };
  const mediaAspect = media.width / media.height;
  const stageAspect = stage.w / stage.h;
  const ratio = mediaAspect / stageAspect;
  if (Math.abs(ratio - 1) <= FIT_TOLERANCE) return { kind: 'cover' };
  if (preference === 'columns' && ratio < 1) {
    const count = Math.min(MAX_COLUMNS, Math.round(stageAspect / mediaAspect));
    if (count >= 2) return { kind: 'columns', count };
  }
  return { kind: 'blur' };
}

export const columnCenter = (count: number) => Math.floor((count - 1) / 2);

/** The items for each column: the current one in the middle, its neighbours either side (repeating if few). */
export function columnItems(items: readonly DisplayItem[], currentId: string, count: number): DisplayItem[] {
  if (!items.length) return [];
  const at = Math.max(
    0,
    items.findIndex((i) => i.id === currentId),
  );
  const centre = columnCenter(count);
  return Array.from(
    { length: count },
    (_, j) => items[(((at + j - centre) % items.length) + items.length) % items.length]!,
  );
}

// -----------------------------------------------------------------------------------------------
// Layouts

export const STRIP_COUNT = 8;

export const stripItems = (items: readonly DisplayItem[], count = STRIP_COUNT) => items.slice(0, count);

export interface MosaicPlan {
  /** Small tiles beside the enlarged one. */
  tiles: number;
  /** CSS grid tracks. */
  columns: string;
  rows: string;
  /** How many cells the enlarged tile spans. */
  bigColumns: number;
  bigRows: number;
}

const fr = (n: number) => `repeat(${n}, minmax(0, 1fr))`;

/**
 * LIV-3 Mosaic: six to twelve items in all, one of them enlarged. The enlarged tile takes 2×2
 * cells of a 3×3, 4×3 or 5×3 grid, so the grid is always full; with fewer than six items it sits
 * beside a single column (a row on a portrait screen) of the others.
 */
export function mosaicPlan(available: number, portrait: boolean): MosaicPlan {
  if (available <= 1) return { tiles: 0, columns: fr(1), rows: fr(1), bigColumns: 1, bigRows: 1 };
  if (available < 6) {
    const tiles = available - 1;
    const big = 'minmax(0, 2.2fr) minmax(0, 1fr)';
    return portrait
      ? { tiles, columns: fr(tiles), rows: big, bigColumns: tiles, bigRows: 1 }
      : { tiles, columns: big, rows: fr(tiles), bigColumns: 1, bigRows: tiles };
  }
  const { long, tiles } =
    available < 9 ? { long: 3, tiles: 5 } : available < 12 ? { long: 4, tiles: 8 } : { long: 5, tiles: 11 };
  return { tiles, columns: fr(portrait ? 3 : long), rows: fr(portrait ? long : 3), bigColumns: 2, bigRows: 2 };
}

/** The newest items other than the enlarged one. */
export const mosaicTiles = (items: readonly DisplayItem[], currentId: string | null, count: number) =>
  items.filter((i) => i.id !== currentId).slice(0, count);

/** A hashtag as shown on screen, with one leading `#`; null when the event has none. */
export function hashtagLabel(tag: string): string | null {
  const bare = tag.replace(/\s+/g, '').replace(/^#+/, '');
  return bare ? `#${bare}` : null;
}

// -----------------------------------------------------------------------------------------------
// LIV-12: the media bytes a screen keeps

/**
 * The cache key for a media URL: its address without the query string. Signed links rotate daily
 * but the file behind them (the output id, or an asset id) never changes.
 */
export function mediaKey(url: string, base: string): string {
  const u = new URL(url, base);
  return `${u.origin}${u.pathname}`;
}

/**
 * Everything a screen keeps offline, most important first: the event's own files, then the newest
 * `limit` items (DISPLAY_ITEM_LIMIT, 200). Pruning deletes anything else; filling downloads in this order.
 */
export function cacheWanted(
  items: readonly DisplayItem[],
  extras: readonly (string | null | undefined)[],
  base: string,
  limit: number,
): { url: string; key: string }[] {
  const seen = new Set<string>();
  const out: { url: string; key: string }[] = [];
  for (const url of [
    ...extras,
    ...orderItems(items)
      .slice(0, limit)
      .map((i) => i.media.url),
  ]) {
    if (!url) continue;
    const key = mediaKey(url, base);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, key });
  }
  return out;
}
