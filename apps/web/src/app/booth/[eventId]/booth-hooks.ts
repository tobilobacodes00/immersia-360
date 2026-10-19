'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';

/**
 * Screen wake lock for the whole time a booth is open (NFR Installability). The lock is released
 * by the browser whenever the tab is hidden, so it is re-acquired on every return to visible.
 * Falls back silently where unsupported (the help centre covers OS-level settings).
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (document.visibilityState === 'visible' && !cancelled) sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // Denied (battery saver, unsupported context): nothing to do.
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
  }, [enabled]);
}

/** True while `active`, and for `releaseMs` after it last was: a hold that outlasts its cause. */
export function useHeld(active: boolean, releaseMs: number): boolean {
  const [held, setHeld] = useState(active);
  // Adjusted during render, not in an effect, so the hold starts in the same commit as its cause.
  if (active && !held) setHeld(true);
  useEffect(() => {
    if (active || !held) return;
    const id = setTimeout(() => setHeld(false), releaseMs);
    return () => clearTimeout(id);
  }, [active, held, releaseMs]);
  return active || held;
}

/** Subscribe a component to a Dexie query; re-renders when the underlying tables change. */
export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });
  useEffect(() => {
    const sub = liveQuery(() => queryRef.current()).subscribe({
      next: setValue,
      error: (err) => console.error('[liveQuery]', err),
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's query inputs
  }, deps);
  return value;
}

/** Online/offline, without a hydration mismatch. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Capture keys (CAP-3): Space and Enter for keyboards, and the keys Bluetooth presentation remotes
 * and camera shutters actually send (PageDown/PageUp, arrows, volume-up arrives as AudioVolumeUp
 * where the OS forwards it). Ignored while typing in a field.
 */
export const CAPTURE_KEYS = new Set([
  ' ',
  'Enter',
  'PageDown',
  'PageUp',
  'ArrowRight',
  'ArrowDown',
  'AudioVolumeUp',
  'F4',
]);

export function useCaptureKeys(enabled: boolean, onTrigger: () => void) {
  const handler = useRef(onTrigger);
  useEffect(() => {
    handler.current = onTrigger;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!CAPTURE_KEYS.has(e.key)) return;
      e.preventDefault();
      handler.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Device heartbeat every 30 s (and right away): last seen + queue depth for the dashboard. */
export function useHeartbeat(
  token: string | null,
  status: () => { eventId: string | null; renderQueue: number; uploadQueue: number },
  onRevoked: () => void,
) {
  const statusRef = useRef(status);
  const revokedRef = useRef(onRevoked);
  useEffect(() => {
    statusRef.current = status;
    revokedRef.current = onRevoked;
  });
  useEffect(() => {
    if (!token) return;
    let stopped = false;
    const beat = async () => {
      if (stopped || !navigator.onLine) return;
      let free: number | null = null;
      try {
        const est = await navigator.storage?.estimate?.();
        if (est?.quota != null && est.usage != null) free = Math.max(0, Math.round(est.quota - est.usage));
      } catch {
        free = null;
      }
      try {
        const res = await fetch('/api/devices/heartbeat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Device ${token}` },
          body: JSON.stringify({
            ...statusRef.current(),
            freeStorageBytes: free,
            appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev',
            at: new Date().toISOString(),
          }),
        });
        if (res.status === 401) revokedRef.current();
      } catch {
        // Offline or flaky network: the next beat will try again.
      }
    };
    void beat();
    const id = setInterval(beat, 30_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [token]);
}
