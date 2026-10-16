'use client';

import { useEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Debounced autosave. Saves the latest value `delay` ms after it stops changing and never overlaps
 * two saves (a change made during a save is saved right after). Values that fail `isValid` are not
 * sent. Status is derived, not guessed: it reads "saved" only when the last successfully stored
 * value IS the current value, so a pending change always shows as "saving".
 */
export function useAutosave<T>(
  value: T,
  save: (value: T) => Promise<boolean>,
  { delay = 600, isValid = () => true }: { delay?: number; isValid?: (value: T) => boolean } = {},
): SaveStatus {
  const [stored, setStored] = useState<T>(value);
  const [everSaved, setEverSaved] = useState(false);
  const [failed, setFailed] = useState<T | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const latest = useRef(value);
  const saveRef = useRef(save);
  const validRef = useRef(isValid);

  useEffect(() => {
    saveRef.current = save;
    validRef.current = isValid;
    latest.current = value;
  });

  useEffect(() => {
    if (Object.is(value, stored)) return;
    const timer = setTimeout(() => {
      const run = async () => {
        if (inFlight.current) await inFlight.current;
        const v = latest.current;
        if (!validRef.current(v)) return;
        const ok = await saveRef.current(v).catch(() => false);
        if (ok) {
          setStored(v);
          setEverSaved(true);
          setFailed(null);
        } else setFailed(v);
      };
      inFlight.current = run().finally(() => {
        inFlight.current = null;
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [value, stored, delay]);

  const dirty = !Object.is(value, stored);
  const status: SaveStatus =
    failed !== null && Object.is(failed, value) ? 'error' : dirty ? 'saving' : everSaved ? 'saved' : 'idle';

  // Warn before leaving with an unsaved change.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return status;
}
