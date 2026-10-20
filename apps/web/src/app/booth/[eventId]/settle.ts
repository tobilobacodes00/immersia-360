import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * Turns a run of quick choices into one: the last value is committed once nothing new has come for
 * `delayMs`, or at once with `flush`. Arrowing through a list of cameras previews each stop but only
 * the one the operator rests on reopens the camera.
 */
export interface Settler<T> {
  /** Remember `value` as the choice; commit it after the delay, or now when `immediate`. */
  choose: (value: T, immediate?: boolean) => void;
  /** Commit the pending choice now, if there is one. */
  flush: () => void;
  /** Forget the pending choice. */
  cancel: () => void;
}

export function createSettler<T>(commit: (value: T) => void, delayMs: number): Settler<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { value: T } | null = null;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const choice = pending;
    pending = null;
    if (choice) commit(choice.value);
  };

  return {
    choose: (value, immediate = false) => {
      pending = { value };
      clearTimeout(timer);
      if (immediate) flush();
      else timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel: () => {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}

/**
 * A settler for the life of a component, committing through the latest `commit`. A choice still
 * pending when the component goes away is committed, not lost.
 */
export function useSettler<T>(commit: (value: T) => void, delayMs: number): Pick<Settler<T>, 'choose' | 'flush'> {
  const latest = useRef(commit);
  const settler = useRef<Settler<T> | null>(null);
  useEffect(() => {
    latest.current = commit;
  });
  useEffect(() => () => settler.current?.flush(), []);
  const choose = useCallback(
    (value: T, immediate?: boolean) => {
      settler.current ??= createSettler<T>((v) => latest.current(v), delayMs);
      settler.current.choose(value, immediate);
    },
    [delayMs],
  );
  const flush = useCallback(() => settler.current?.flush(), []);
  return useMemo(() => ({ choose, flush }), [choose, flush]);
}
