'use client';

import { useEffect, useState } from 'react';
import type { AssetView } from '@/server/assets';

/**
 * The event's files on the booth device (overlay images, intro/outro, music, uploaded fonts, logo),
 * kept in Cache Storage so a booth that loses its connection keeps rendering exactly what the
 * operator designed. Asset ids never change content (a new upload is a new id), so a cached copy is
 * valid forever; the signed URLs in the page are only used to fill the cache.
 */
const CACHE = 'immersia-event-assets-v1';
const keyOf = (id: string) => `/__event-assets/${id}`;
/** Without Cache Storage (rare), files are held in memory for this page only. */
const memory = new Map<string, Blob>();

const hasCaches = () => typeof caches !== 'undefined';

export async function cachedAsset(id: string): Promise<Blob | null> {
  const mem = memory.get(id);
  if (mem) return mem;
  if (!hasCaches()) return null;
  const hit = await (await caches.open(CACHE)).match(keyOf(id)).catch(() => undefined);
  return hit ? hit.blob() : null;
}

async function fill(a: AssetView): Promise<void> {
  if (memory.has(a.id)) return;
  const cache = hasCaches() ? await caches.open(CACHE) : null;
  if (cache && (await cache.match(keyOf(a.id)))) return;
  const res = await fetch(a.url);
  if (!res.ok) throw new Error(`asset ${a.id}: ${res.status}`);
  const blob = await res.blob();
  if (cache) await cache.put(keyOf(a.id), new Response(blob, { headers: { 'content-type': a.mime } }));
  else memory.set(a.id, blob);
}

/** One fill per set of assets per page: hooks and render jobs share it. Resolves to how many are missing. */
const fills = new Map<string, Promise<number>>();

export function fillAssets(assets: readonly AssetView[]): Promise<number> {
  const key = assets
    .map((a) => a.id)
    .sort()
    .join(',');
  let fillRun = fills.get(key);
  if (!fillRun) {
    const queue = [...assets];
    let missing = 0;
    const worker = async () => {
      for (let a = queue.shift(); a; a = queue.shift()) await fill(a).catch(() => void missing++);
    };
    fillRun = Promise.all([worker(), worker(), worker()]).then(() => {
      // Something was unreachable (offline at open): let the next caller try again.
      if (missing) fills.delete(key);
      return missing;
    });
    fills.set(key, fillRun);
  }
  return fillRun;
}

export interface EventAssetsState {
  /** Every file is on the device. */
  ready: boolean;
  /** Files that could not be fetched (offline on first open, or expired links): the booth still runs. */
  missing: number;
}

/** Make sure every asset the event uses is on this device; fetches what isn't, three at a time. */
export function useEventAssets(assets: readonly AssetView[]): EventAssetsState {
  const [state, setState] = useState<EventAssetsState>({ ready: assets.length === 0, missing: 0 });
  useEffect(() => {
    if (!assets.length) return;
    let live = true;
    void fillAssets(assets).then((missing) => {
      if (live) setState({ ready: missing === 0, missing });
    });
    return () => {
      live = false;
    };
  }, [assets]);
  return state;
}
