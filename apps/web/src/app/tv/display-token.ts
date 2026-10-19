import { wipeMediaCache } from './live/media-cache';

/** The paired display's token: how a TV with no login proves which event it shows (LIV-1). */
export const DISPLAY_TOKEN_KEY = 'immersia.display.token';
/** The last good feed, for starting (and looping) offline. */
export const DISPLAY_FEED_KEY = 'immersia.display.feed';

export function readDisplayToken(): string | null {
  try {
    return localStorage.getItem(DISPLAY_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** False when the browser won't keep it (private browsing, storage blocked): pairing can't last. */
export function saveDisplayToken(token: string): boolean {
  try {
    // A feed cached for another event must never show first.
    localStorage.removeItem(DISPLAY_FEED_KEY);
    localStorage.setItem(DISPLAY_TOKEN_KEY, token);
    return readDisplayToken() === token;
  } catch {
    return false;
  }
}

/** The display was removed: forget the pairing and every guest file kept for it. */
export function clearDisplayToken(): void {
  try {
    localStorage.removeItem(DISPLAY_TOKEN_KEY);
    localStorage.removeItem(DISPLAY_FEED_KEY);
  } catch {
    // Blocked storage has nothing to forget.
  }
  void wipeMediaCache();
}
