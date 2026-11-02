import { and, eq, gt, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { captureSession } from '@immersia/db/schema';

/**
 * Which sessions the client gallery lists (screen 19, SHR-5), and with them the ZIP of the public gallery, the
 * event dashboard's count and the candidates of the highlight reel (LIV-14): one rule, written once, as a SQL
 * condition and as the same rule over a session's facts, so each can be tested against the other.
 *
 * The rule is the session-state model of share-state.ts (only `live` and `pending` sessions are served, and the
 * gallery lists those with a file), plus the two things a guest or the operator can decide about the gallery:
 *
 * - the guest asked to stay off screens (`opted_out_of_display`, LIV-8);
 * - the operator hid the item in the Live Display's moderation (`display_status = 'hidden'`, LIV-7).
 *
 * What the gallery does NOT read is `display_status = 'opted_out'`. That value belongs to the Live Display: it is
 * also written for a session captured while the display was off, so that its guest, who was never told it might
 * appear on a screen, never appears on one later. Such a session is a perfectly good gallery item. Reading it as
 * "the guest declined" left the gallery of any event that never turned Live Display on empty, and with it the
 * highlight reel that is built from the gallery.
 *
 * Kept free of the database client and of `server-only`, so the tests can compile it.
 */

/** What the rule reads off a session row. */
export interface GalleryFacts {
  status: 'pending' | 'live' | 'expired';
  expiresAt: Date;
  expiredAt: Date | null;
  erasedAt: Date | null;
  /** Set when the session is hidden by the operator or taken down by the platform (either way it is not served). */
  removedAt: Date | null;
  optedOutOfDisplay: boolean;
  displayStatus: 'pending' | 'shown' | 'hidden' | 'opted_out';
}

interface Rule {
  /** Why a session fails it, for the tests' messages. */
  id: string;
  holds: (s: GalleryFacts, now: Date) => boolean;
  sql: SQL;
}

const RULES: readonly Rule[] = [
  { id: 'has-a-file', holds: (s) => s.status === 'live', sql: eq(captureSession.status, 'live') },
  // Expired by the sweep, or by the clock before the sweep has run (share-state.ts: `isExpired`).
  { id: 'not-swept', holds: (s) => s.expiredAt === null, sql: isNull(captureSession.expiredAt) },
  {
    id: 'not-past-retention',
    holds: (s, now) => s.expiresAt.getTime() > now.getTime(),
    sql: gt(captureSession.expiresAt, sql`now()`),
  },
  { id: 'not-erased', holds: (s) => s.erasedAt === null, sql: isNull(captureSession.erasedAt) },
  { id: 'not-removed', holds: (s) => s.removedAt === null, sql: isNull(captureSession.removedAt) },
  {
    id: 'guest-did-not-opt-out',
    holds: (s) => !s.optedOutOfDisplay,
    sql: eq(captureSession.optedOutOfDisplay, false),
  },
  {
    id: 'operator-did-not-hide-from-display',
    holds: (s) => s.displayStatus !== 'hidden',
    sql: ne(captureSession.displayStatus, 'hidden'),
  },
];

/** The rule over a session's facts: the same decision as `publicSessions`, for tests and for reasoning about it. */
export function isGalleryListed(session: GalleryFacts, now = new Date()): boolean {
  return RULES.every((rule) => rule.holds(session, now));
}

/** The first rule a session fails (null when it is listed), to say why in a test. */
export function galleryExclusion(session: GalleryFacts, now = new Date()): string | null {
  return RULES.find((rule) => !rule.holds(session, now))?.id ?? null;
}

/** Sessions of an event that guests may browse. */
export const publicSessions = (eventId: string) =>
  and(eq(captureSession.eventId, eventId), ...RULES.map((rule) => rule.sql));
