'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  SETUP_CHECK_EVENT,
  SETUP_CHECK_KEY,
  checkIsDue,
  markCheckSkipped,
  readCheckState,
} from '@/lib/setup-check/state';

/** localStorage can throw on access (blocked site data); a browser that can't remember is never nagged. */
const storage = (): Pick<Storage, 'getItem' | 'setItem'> | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SETUP_CHECK_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(SETUP_CHECK_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(SETUP_CHECK_EVENT, onChange);
  };
}

/**
 * HLP-1: the first time a device opens a booth it is offered the setup check. Due until the check
 * has been run or skipped on this device; the answer is remembered in this browser.
 */
export function useSetupCheckPrompt(deviceId: string | null) {
  const due = useSyncExternalStore(
    subscribe,
    () => {
      const s = storage();
      return deviceId && s ? checkIsDue(readCheckState(s, deviceId)) : false;
    },
    () => false,
  );
  const skip = useCallback(() => {
    const s = storage();
    if (!deviceId || !s) return;
    markCheckSkipped(s, deviceId, Date.now());
    window.dispatchEvent(new Event(SETUP_CHECK_EVENT));
  }, [deviceId]);
  return { due, skip };
}
