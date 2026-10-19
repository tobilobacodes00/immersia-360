'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DISPLAY_ITEM_LIMIT, type DisplayFeed, type DisplayItem, type LiveMessage } from '@immersia/shared';

export type LiveConnection = 'socket' | 'polling' | 'offline';

/** Without the hub, screens poll: inside LIV-2's five seconds. */
const POLL_MS = 4000;
/** With the hub, a slow refresh keeps signed media links fresh and the display marked as seen. */
const REFRESH_MS = 60_000;
const PING_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

interface Options {
  /** The feed endpoint. */
  url: string;
  headers?: Record<string, string>;
  /**
   * localStorage key for the last good feed: a screen starts (and keeps looping) offline (LIV-12).
   * Only for screens rendered in the browser alone (no server render to hydrate against).
   */
  cacheKey?: string;
  /** The display was removed or never paired. */
  onUnauthorized?: () => void;
  /** Operators: the approve-first queue changed. */
  onQueue?: () => void;
}

function readCache(key: string): DisplayFeed | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as DisplayFeed) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, feed: DisplayFeed) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...feed, socket: null }));
  } catch {
    // Storage full or blocked: the screen still works, it just won't start offline.
  }
}

/** Newest first, one entry per session, at most DISPLAY_ITEM_LIMIT. */
export function upsertItem(items: DisplayItem[], item: DisplayItem): DisplayItem[] {
  return [item, ...items.filter((i) => i.id !== item.id)]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, DISPLAY_ITEM_LIMIT);
}

/**
 * A screen's live feed (displays, the Sharing Station, the operator's control page). The database
 * is the truth; the hub socket brings changes within a second; polling covers a missing hub or a
 * dropped socket. On reconnect the socket resumes from the last message it saw.
 */
export function useLiveFeed({ url, headers, cacheKey, onUnauthorized, onQueue }: Options) {
  const [feed, setFeed] = useState<DisplayFeed | null>(() => (cacheKey ? readCache(cacheKey) : null));
  const [items, setItems] = useState<DisplayItem[]>(() => (cacheKey ? (readCache(cacheKey)?.items ?? []) : []));
  const [connection, setConnection] = useState<LiveConnection>('polling');
  const etag = useRef<string | null>(null);
  const seq = useRef<number | null>(null);
  const socketUrl = useRef<string | null>(null);
  const callbacks = useRef({ onUnauthorized, onQueue, headers });
  useEffect(() => {
    callbacks.current = { onUnauthorized, onQueue, headers };
  });

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(url, {
        headers: { ...callbacks.current.headers, ...(etag.current ? { 'if-none-match': etag.current } : {}) },
        cache: 'no-store',
      });
      if (res.status === 401) {
        callbacks.current.onUnauthorized?.();
        return false;
      }
      if (res.status === 304) return true;
      if (!res.ok) return false;
      const next = (await res.json()) as DisplayFeed;
      etag.current = res.headers.get('etag');
      socketUrl.current = next.socket;
      setFeed(next);
      setItems(next.items);
      if (cacheKey) writeCache(cacheKey, next);
      return true;
    } catch {
      return false;
    }
  }, [url, cacheKey]);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    let backoff = 1000;

    const schedulePoll = (ms: number) => {
      clearTimeout(poll);
      poll = setTimeout(async () => {
        if (stopped) return;
        const ok = await load();
        if (!socket || socket.readyState !== WebSocket.OPEN) setConnection(ok ? 'polling' : 'offline');
        schedulePoll(socket?.readyState === WebSocket.OPEN ? REFRESH_MS : POLL_MS);
        if (!socket && socketUrl.current) connect();
      }, ms);
    };

    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string' || event.data === 'pong') return;
      let message: LiveMessage;
      try {
        message = JSON.parse(event.data) as LiveMessage;
      } catch {
        return;
      }
      seq.current = Math.max(seq.current ?? 0, message.seq);
      switch (message.type) {
        case 'hello':
          // Anything published between the last feed read and this connection is in the feed now.
          void load();
          break;
        case 'item':
          setItems((list) => upsertItem(list, message.item));
          break;
        case 'remove':
          setItems((list) => list.filter((i) => i.id !== message.id));
          break;
        case 'config':
        case 'reset':
          etag.current = null;
          void load();
          break;
        case 'queue':
          callbacks.current.onQueue?.();
          break;
      }
    };

    const connect = () => {
      const base = socketUrl.current;
      if (stopped || !base || socket) return;
      const since = seq.current !== null ? `&since=${seq.current}` : '';
      const ws = new WebSocket(`${base}${since}`);
      socket = ws;
      ws.onopen = () => {
        backoff = 1000;
        setConnection('socket');
        clearInterval(ping);
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS);
        schedulePoll(REFRESH_MS);
      };
      ws.onmessage = onMessage;
      ws.onclose = () => {
        clearInterval(ping);
        if (socket === ws) socket = null;
        if (stopped) return;
        setConnection('polling');
        schedulePoll(POLL_MS);
        // A fresh feed brings a fresh socket token; reconnect with backoff.
        clearTimeout(retry);
        retry = setTimeout(() => void load().then(connect), backoff);
        backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
      };
    };

    void load().then((ok) => {
      if (stopped) return;
      setConnection(ok ? 'polling' : 'offline');
      if (socketUrl.current) connect();
      schedulePoll(socketUrl.current ? REFRESH_MS : POLL_MS);
    });

    return () => {
      stopped = true;
      clearTimeout(poll);
      clearTimeout(retry);
      clearInterval(ping);
      socket?.close();
    };
  }, [load]);

  return { feed, items, connection, refresh: load };
}
