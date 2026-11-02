import { useState } from 'react';

/**
 * Opening a camera takes a while (a permission prompt, a USB device waking up) and can be started
 * again before it finishes: a double tap on Start or Try again, a lens picked mid-start, or the booth
 * left for another page while the prompt is open. Each open takes a token; only the newest token's
 * result may be used. An open that was overtaken (or abandoned by `cancel`) stops the stream it got,
 * so no camera is left running with nothing holding it.
 */
export interface OpenGuard {
  /** Start an open: it supersedes every open before it. */
  begin: () => number;
  /** Whether `token` is still the newest open and nothing cancelled it. */
  isCurrent: (token: number) => boolean;
  /** Abandon any open in flight (the booth is going away). */
  cancel: () => void;
}

export function createOpenGuard(): OpenGuard {
  let generation = 0;
  return {
    begin: () => ++generation,
    isCurrent: (token) => token === generation,
    cancel: () => {
      generation++;
    },
  };
}

/** One guard for the life of the booth component. */
export function useOpenGuard(): OpenGuard {
  return useState(createOpenGuard)[0];
}
