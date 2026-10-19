'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A CSS media query as React state. `serverValue` is what the server render and hydration assume;
 * the real value takes over right after hydration.
 */
export function useMediaQuery(query: string, serverValue: boolean): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', notify);
      return () => mql.removeEventListener('change', notify);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
