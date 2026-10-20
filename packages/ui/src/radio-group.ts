'use client';

import { useRef, type KeyboardEvent } from 'react';

/**
 * The ARIA radio group keyboard pattern for a set of buttons (role="radio"): one tab stop (the
 * selected radio, or the first enabled one), Arrow keys move to the next or previous enabled radio
 * and select it (wrapping), Home and End jump to the first and last.
 * https://www.w3.org/WAI/ARIA/apg/patterns/radio/
 */

/** Keys the pattern handles, as the radio each one moves to; `undefined` for any other key. */
export function nextRadio<T>(
  values: readonly T[],
  from: T,
  key: string,
  isDisabled: (value: T) => boolean = () => false,
): T | undefined {
  const enabled = values.filter((v) => !isDisabled(v) || v === from);
  if (enabled.length === 0) return undefined;
  const at = enabled.indexOf(from);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return enabled[(at + 1) % enabled.length];
    case 'ArrowLeft':
    case 'ArrowUp':
      return enabled[(at - 1 + enabled.length) % enabled.length];
    case 'Home':
      return enabled[0];
    case 'End':
      return enabled[enabled.length - 1];
    default:
      return undefined;
  }
}

/** Which radio is the tab stop: the selected one if it can be used, else the first that can. */
export function tabStop<T>(values: readonly T[], selected: T | null, isDisabled: (value: T) => boolean = () => false) {
  if (selected !== null && values.includes(selected) && !isDisabled(selected)) return selected;
  return values.find((v) => !isDisabled(v));
}

export function useRadioGroup<T extends string>({
  values,
  value,
  onChange,
  isDisabled = () => false,
}: {
  values: readonly T[];
  /** The selected value, or null when nothing is. */
  value: T | null;
  onChange: (value: T) => void;
  isDisabled?: (value: T) => boolean;
}) {
  const nodes = useRef(new Map<T, HTMLElement>());
  const stop = tabStop(values, value, isDisabled);

  return {
    /** Spread on the container. */
    group: { role: 'radiogroup' } as const,
    /** Spread on each radio button. */
    item: (v: T) => ({
      role: 'radio' as const,
      'aria-checked': v === value,
      tabIndex: v === stop ? 0 : -1,
      ref: (el: HTMLElement | null) => {
        if (el) nodes.current.set(v, el);
        else nodes.current.delete(v);
      },
      onClick: () => onChange(v),
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const next = nextRadio(values, v, e.key, isDisabled);
        if (next === undefined) return;
        e.preventDefault();
        if (next !== v) onChange(next);
        nodes.current.get(next)?.focus();
      },
    }),
  };
}
