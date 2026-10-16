'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * True once React has hydrated on the client. Forms disable their submit until then, so an early
 * click can't fall through to a native form submission (which would reload the page and could put
 * field values, like an email address, in the URL).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
