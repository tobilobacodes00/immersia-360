'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMediaSrc } from './use-media';

/**
 * Behaviour a screen on a wall needs: stay awake, hide the mouse, go full screen, tell the
 * operator what changed without leaving clutter, and play sound once the browser allows it.
 */

/** Keep the screen awake for as long as the display is open; re-acquired whenever the tab is shown again. */
export function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (document.visibilityState === 'visible' && !cancelled) sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // Denied (battery saver, unsupported context): the TV's own settings keep it awake.
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);
}

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** True after any pointer or key activity, until the screen has been left alone for `idleMs`. */
export function useActivity(idleMs: number): boolean {
  const [active, setActive] = useState(true);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const idle = () => setActive(false);
    const wake = () => {
      setActive(true);
      clearTimeout(timer);
      timer = setTimeout(idle, idleMs);
    };
    timer = setTimeout(idle, idleMs);
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, wake, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, wake);
    };
  }, [idleMs]);
  return active;
}

const noopSubscribe = () => () => {};
const onFullscreenChange = (notify: () => void) => {
  document.addEventListener('fullscreenchange', notify);
  return () => document.removeEventListener('fullscreenchange', notify);
};

/** Full screen on demand (the browser only allows it from a key press or click), and with the F key. */
export function useFullscreen() {
  const active = useSyncExternalStore(
    onFullscreenChange,
    () => document.fullscreenElement !== null,
    () => false,
  );
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => document.fullscreenEnabled,
    () => false,
  );
  const toggle = useCallback(() => {
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    request.catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!supported) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [supported, toggle]);
  return { supported, active, toggle };
}

/** True at the start and for `ms` after `value` last changed: how long a status stays on screen. */
export function useFlash(value: unknown, ms: number): boolean {
  const [seen, setSeen] = useState(() => value);
  const [flash, setFlash] = useState(true);
  // Adjusted while rendering so the status shows in the same frame as the change.
  if (value !== seen) {
    setSeen(() => value);
    setFlash(true);
  }
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(false), ms);
    return () => clearTimeout(id);
  }, [flash, value, ms]);
  return flash;
}

/**
 * Whether the browser has seen a key press or click on this page. Until then it refuses sound, so
 * videos start muted and background music waits; the remote's OK button is enough to lift that.
 */
export function useUserGesture(): boolean {
  const [seen, setSeen] = useState(() => navigator.userActivation?.hasBeenActive ?? false);
  useEffect(() => {
    if (seen) return;
    const go = () => setSeen(true);
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    for (const type of events) window.addEventListener(type, go, { passive: true });
    return () => {
      for (const type of events) window.removeEventListener(type, go);
    };
  }, [seen]);
  return seen;
}

/** The size of an element, kept current: pass the returned function as its `ref`. */
export function useElementSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ref = useCallback((node: T | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) setSize((s) => (s.w === box.width && s.h === box.height ? s : { w: box.width, h: box.height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * LIV-10: optional background music, looping quietly. If the browser refuses to start it without a
 * gesture, `onBlocked` says so and it starts as soon as `unlocked` turns true.
 */
export function useBackgroundMusic({
  url,
  volume,
  unlocked,
  onBlocked,
}: {
  url: string | null;
  volume: number;
  unlocked: boolean;
  onBlocked: () => void;
}) {
  const src = useMediaSrc(url);
  const audio = useRef<HTMLAudioElement | null>(null);
  const latest = useRef({ volume, onBlocked });
  useEffect(() => {
    latest.current = { volume, onBlocked };
  });

  useEffect(() => {
    if (!src) return;
    const el = new Audio(src);
    el.loop = true;
    el.volume = latest.current.volume;
    audio.current = el;
    void el.play().catch(() => latest.current.onBlocked());
    return () => {
      el.pause();
      el.removeAttribute('src');
      el.load();
      if (audio.current === el) audio.current = null;
    };
  }, [src]);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume, src]);

  useEffect(() => {
    if (unlocked) void audio.current?.play().catch(() => undefined);
  }, [unlocked, src]);
}
