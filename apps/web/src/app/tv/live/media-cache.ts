import { mediaKey } from './playback';

/**
 * LIV-12: the media bytes of the newest items, in Cache Storage, so a screen that loses its network
 * keeps looping and one that restarts offline still has something to show. Entries are keyed by the
 * media address without its query string (see mediaKey): signed links rotate daily, the file does
 * not. Playback reads from here through object URLs that are revoked when nothing uses them.
 */
const CACHE = 'immersia-display-media-v1';

const hasCaches = () => typeof caches !== 'undefined';
const keyOf = (url: string) => mediaKey(url, location.href);

const cacheStore = () => caches.open(CACHE);

async function cachedBlob(key: string): Promise<Blob | null> {
  if (!hasCaches()) return null;
  try {
    const hit = await (await cacheStore()).match(key);
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

export async function cachedKeys(): Promise<Set<string>> {
  if (!hasCaches()) return new Set();
  try {
    return new Set((await (await cacheStore()).keys()).map((r) => r.url));
  } catch {
    return new Set();
  }
}

/** Newest first, set by the latest sync: what to give up first when the device runs out of room. */
let keepOrder: string[] = [];

/** Delete the oldest cached entry that comes after `key` in the keep order. */
async function evictOlderThan(key: string): Promise<boolean> {
  const mine = keepOrder.indexOf(key);
  if (mine < 0) return false;
  const cached = await cachedKeys();
  const victim = keepOrder.findLast((k, i) => i > mine && cached.has(k));
  return victim === undefined ? false : (await cacheStore()).delete(victim);
}

/** The whole file, or null: a partial or failed response must never be played back as the item. */
async function download(url: string): Promise<Response | null> {
  const res = await fetch(url);
  return res.status === 200 ? res : null;
}

const inflight = new Map<string, Promise<boolean>>();

/** Download one file into the cache; true when it is there afterwards. One download per file at a time. */
export function store(url: string): Promise<boolean> {
  if (!hasCaches()) return Promise.resolve(false);
  const key = keyOf(url);
  let run = inflight.get(key);
  if (!run) {
    run = (async () => {
      try {
        const cache = await cacheStore();
        if (await cache.match(key)) return true;
        const first = await download(url);
        if (!first) return false;
        try {
          await cache.put(key, first);
        } catch {
          // A full device throws here: make room by dropping the oldest item and try once more
          // (from the network again; teeing a large body would hold all of it in memory).
          if (!(await evictOlderThan(key))) return false;
          const again = await download(url);
          if (!again) return false;
          await cache.put(key, again);
        }
        return true;
      } catch {
        return false;
      }
    })().finally(() => inflight.delete(key));
    inflight.set(key, run);
  }
  return run;
}

/** Drop everything that is no longer wanted: items that left the list, hidden, opted out or expired. */
async function prune(keep: ReadonlySet<string>): Promise<void> {
  if (!hasCaches()) return;
  try {
    const cache = await cacheStore();
    for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
  } catch {
    // Storage went away mid-way: the next sync prunes again.
  }
}

/** Remove every cached byte (the display was removed, or re-paired). */
export async function wipeMediaCache(): Promise<void> {
  if (!hasCaches()) return;
  try {
    await caches.delete(CACHE);
  } catch {
    // Nothing to wipe.
  }
}

/**
 * Bring the cache in line with `wanted`: prune what is not listed, then download what is missing,
 * most important first, two at a time. Returns a function that stops after the downloads in flight.
 */
export function syncMediaCache(wanted: readonly { url: string; key: string }[]): () => void {
  let stopped = false;
  keepOrder = wanted.map((w) => w.key);
  void (async () => {
    await prune(new Set(keepOrder));
    const have = await cachedKeys();
    const queue = wanted.filter((w) => !have.has(w.key));
    const worker = async () => {
      for (let next = queue.shift(); next && !stopped; next = queue.shift()) {
        if (!navigator.onLine) return;
        await store(next.url);
      }
    };
    await Promise.all([worker(), worker()]);
  })();
  return () => {
    stopped = true;
  };
}

// -----------------------------------------------------------------------------------------------
// Playback sources

export interface MediaLease {
  /** What to put in `src`: an object URL for cached bytes, the network address otherwise. */
  src: string;
  release: () => void;
}

const objectUrls = new Map<string, { href: string; refs: number; timer?: ReturnType<typeof setTimeout> }>();
/** An object URL outlives its last user briefly, so a cross-fade never meets a revoked address. */
const REVOKE_AFTER_MS = 2000;

function lease(key: string, entry: { href: string; refs: number; timer?: ReturnType<typeof setTimeout> }): MediaLease {
  clearTimeout(entry.timer);
  entry.refs++;
  let released = false;
  return {
    src: entry.href,
    release() {
      if (released) return;
      released = true;
      if (--entry.refs > 0) return;
      entry.timer = setTimeout(() => {
        if (entry.refs > 0) return;
        URL.revokeObjectURL(entry.href);
        objectUrls.delete(key);
      }, REVOKE_AFTER_MS);
    },
  };
}

/**
 * Where to play a file from. Cached bytes play from an object URL (shared, reference counted);
 * otherwise the network address is used and the file is fetched into the cache for next time.
 * The choice is made once per use, so a video is never switched to another source mid-play.
 */
export async function acquire(url: string): Promise<MediaLease> {
  const key = keyOf(url);
  const held = objectUrls.get(key);
  if (held) return lease(key, held);
  const blob = await cachedBlob(key);
  if (!blob) {
    void store(url);
    return { src: url, release: () => {} };
  }
  // Another caller may have made the object URL while the bytes were being read.
  const entry = objectUrls.get(key) ?? { href: URL.createObjectURL(blob), refs: 0 };
  objectUrls.set(key, entry);
  return lease(key, entry);
}
