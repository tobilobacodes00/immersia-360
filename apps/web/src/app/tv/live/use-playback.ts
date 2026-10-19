'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { DisplayItem } from '@immersia/shared';
import {
  JUST_IN_MS,
  advanceDelayMs,
  currentItem,
  hasWaitingArrival,
  initialPlayer,
  isJustIn,
  itemDurationMs,
  playerReducer,
} from './playback';

/** Items whose media would not load are tried again after this long. */
const RETRY_FAILED_MS = 60_000;

/**
 * Plays the feed's items (LIV-2, LIV-10): newest first, each for its dwell, a new arrival next. The
 * rules live in playback.ts; this connects them to the clock. `items` is null until a feed exists.
 */
export function usePlayback(items: readonly DisplayItem[] | null, dwellSeconds: number) {
  const [state, dispatch] = useReducer(playerReducer, initialPlayer);
  // The list is folded into the player while rendering (not in an effect), so a new arrival is
  // queued in the same frame it is received.
  if (items && items !== state.source) dispatch({ type: 'items', items });

  const current = currentItem(state);

  // A video's own length, once its player knows it, belongs to one play of one item.
  const [length, setLength] = useState<{ playId: number; seconds: number } | null>(null);
  const videoSeconds = length && length.playId === state.playId ? length.seconds : null;
  const durationMs = current ? itemDurationMs(current, dwellSeconds, videoSeconds) : 0;
  const jump = hasWaitingArrival(state) && !state.currentFresh;

  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = performance.now();
  }, [state.playId]);

  useEffect(() => {
    if (state.currentId === null) return;
    const delay = advanceDelayMs({ durationMs, elapsedMs: performance.now() - startedAt.current, jump });
    const timer = setTimeout(() => dispatch({ type: 'advance' }), delay);
    return () => clearTimeout(timer);
  }, [state.playId, state.currentId, durationMs, jump]);

  const hasFailed = Object.keys(state.failed).length > 0;
  useEffect(() => {
    if (!hasFailed) return;
    const timer = setTimeout(() => dispatch({ type: 'retry' }), RETRY_FAILED_MS);
    return () => clearTimeout(timer);
  }, [hasFailed]);

  // "Just in" fades after a couple of minutes without another arrival. The ids are the dependency,
  // not the list, so a feed re-read that changes nothing does not extend it.
  const freshIds = state.fresh.join(',');
  useEffect(() => {
    if (!freshIds) return;
    const timer = setTimeout(() => dispatch({ type: 'cool' }), JUST_IN_MS);
    return () => clearTimeout(timer);
  }, [freshIds]);

  const reportLength = useCallback((playId: number, seconds: number) => setLength({ playId, seconds }), []);
  const fail = useCallback((id: string) => dispatch({ type: 'failed', id }), []);
  const justIn = useCallback((id: string) => isJustIn(state, id), [state]);

  return {
    /** Newest first. */
    items: state.items,
    current,
    playId: state.playId,
    durationMs,
    currentJustIn: current !== null && isJustIn(state, current.id),
    justIn,
    reportLength,
    fail,
  };
}
