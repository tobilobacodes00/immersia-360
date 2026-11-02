'use client';

import { useEffect, useRef, useState } from 'react';
import { DISPLAY_ITEM_LIMIT, type DisplayItem } from '@immersia/shared';
import { acquire, syncMediaCache } from './media-cache';
import { cacheWanted, mediaKey } from './playback';

/**
 * Where to play a file from (LIV-12): its cached bytes when the device has them, the network
 * otherwise. Null for the first moment while the cache is asked. The source is fixed for as long as
 * the file's address (without its query string) stays the same, so a signed link that rotates
 * mid-play never restarts a video.
 */
export function useMediaSrc(url: string | null): string | null {
  const [resolved, setResolved] = useState<{ key: string; src: string } | null>(null);
  const latest = useRef(url);
  useEffect(() => {
    latest.current = url;
  });
  const key = url ? mediaKey(url, location.href) : null;

  useEffect(() => {
    const address = latest.current;
    if (!key || !address) return;
    let cancelled = false;
    let release = () => {};
    void acquire(address)
      .then((lease) => {
        if (cancelled) return lease.release();
        release = lease.release;
        setResolved({ key, src: lease.src });
      })
      // Whatever went wrong with the cache, the network address still plays.
      .catch(() => {
        if (!cancelled) setResolved({ key, src: address });
      });
    return () => {
      cancelled = true;
      release();
    };
  }, [key]);

  return resolved && resolved.key === key ? resolved.src : null;
}

/** How often to try again for files that could not be downloaded (offline, or a hiccup). */
const RETRY_MS = 2 * 60_000;

/**
 * Keep the device's copy of the newest items and the event's own files in step with the feed:
 * download what is missing in the background, delete what left the list. Runs again when the set of
 * files changes, when the network returns, and every couple of minutes.
 */
export function useMediaCacheSync(items: readonly DisplayItem[], extras: readonly (string | null | undefined)[]) {
  const wanted = cacheWanted(items, extras, location.href, DISPLAY_ITEM_LIMIT);
  // Feeds are re-read often and mostly unchanged: only a change in the set of files restarts the sync.
  const signature = wanted.map((w) => w.key).join('\n');
  const latest = useRef(wanted);
  useEffect(() => {
    latest.current = wanted;
  });

  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const again = () => setRetry((n) => n + 1);
    window.addEventListener('online', again);
    const timer = setInterval(again, RETRY_MS);
    return () => {
      window.removeEventListener('online', again);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => syncMediaCache(latest.current), [signature, retry]);
}
