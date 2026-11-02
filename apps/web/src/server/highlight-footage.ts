import { sql } from 'drizzle-orm';
import type { RemovalBasis } from '@immersia/shared/reports';
import { isGalleryListed, type GalleryFacts } from './gallery-filter';
import { isExpired, isPlatformRemoval, removalOf } from './share-state';

/**
 * What becomes of a highlight reel (LIV-14) when something happens to a session whose footage is in it. A reel is
 * a copy of its guests' footage, so it follows the session-state model of share-state.ts, clip by clip:
 *
 * - `delete`: the footage is meant to be gone: the guest erased the session, its retention ran out, the guest
 *   asked to stay off screens, or the platform took it down (policy or illegal content). The reel is deleted, with
 *   its files, and cannot come back.
 * - `withhold`: the reel is kept but not shown, because the gallery does not list the clip: the operator hid it (the
 *   session, or in the Live Display's moderation). That is the operator's own, reversible decision; unhiding it
 *   brings the reel back.
 * - `keep`: the clip is in the gallery.
 *
 * A reel's fate is the worst fate of its clips. Kept free of the database client and of `server-only`.
 */

export type ReelClipFate = 'keep' | 'withhold' | 'delete';

export interface FootageFacts extends GalleryFacts {
  /** Why `removedAt` is set: an operator's hide (reversible), or a platform takedown. */
  removal: RemovalBasis | null;
}

/** The footage must go from the platform (the clip is not merely hidden). */
export function footageIsGone(s: FootageFacts, now = new Date()): boolean {
  return (
    s.erasedAt !== null ||
    isExpired(s, now) ||
    s.optedOutOfDisplay ||
    // A takedown outranks an operator's hide: it is the platform's decision, and the files are deleted or quarantined.
    isPlatformRemoval(removalOf(s))
  );
}

export function reelClipFate(s: FootageFacts, now = new Date()): ReelClipFate {
  if (footageIsGone(s, now)) return 'delete';
  return isGalleryListed(s, now) ? 'keep' : 'withhold';
}

const WORST: Record<ReelClipFate, number> = { keep: 0, withhold: 1, delete: 2 };

/** What becomes of a reel whose clips have these fates (a reel with no clips is kept). */
export function reelFate(clips: readonly ReelClipFate[]): ReelClipFate {
  return clips.reduce<ReelClipFate>((worst, fate) => (WORST[fate] > WORST[worst] ? fate : worst), 'keep');
}

/**
 * `footageIsGone` as a SQL condition over `capture_session` aliased `s` (the sweep joins it that way). Pinned against
 * the function by tests: change them together.
 */
export const footageGoneSql = sql`(
  s.erased_at is not null
  or s.expired_at is not null
  or s.expires_at <= now()
  or s.opted_out_of_display
  or (s.removed_at is not null and coalesce(s.removal, 'policy') <> 'operator')
)`;
