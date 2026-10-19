'use client';

import { createContext, use } from 'react';
import type { DisplayConfig, DisplayItem } from '@immersia/shared';

/** What every layout needs to draw the screen; built once per render by the display app. */
export interface DisplayView {
  config: DisplayConfig;
  /** Newest first. */
  items: DisplayItem[];
  /** The item on screen; null when there is nothing to play. */
  current: DisplayItem | null;
  /** Counts every pick: the same item shown again is a new play. */
  playId: number;
  durationMs: number;
  currentJustIn: boolean;
  justIn: (id: string) => boolean;
  /** The browser has seen a key press or click, so it allows sound. */
  unlocked: boolean;
  reportLength: (playId: number, seconds: number) => void;
  fail: (id: string) => void;
  reportSoundBlocked: () => void;
}

const DisplayContext = createContext<DisplayView | null>(null);
export const DisplayProvider = DisplayContext;

export function useDisplay(): DisplayView {
  const view = use(DisplayContext);
  if (!view) throw new Error('useDisplay outside the display');
  return view;
}
