import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { removalHttpStatus, type RemovalBasis } from '@immersia/shared/reports';

/**
 * Session state by link id: the one model every surface of a guest session agrees on. Kept apart
 * from share.ts (no storage SDK) because the proxy imports it for the 410/451 pages (DL-9).
 *
 * A session is in exactly one of these states, decided by `stateOf` from the first rule that holds:
 *
 * | # | Facts on the row                                 | State     | Link answers                          |
 * |---|--------------------------------------------------|-----------|---------------------------------------|
 * | 1 | platform takedown, basis `legal` (illegal)       | `removed` | 451 "removed"                         |
 * | 2 | platform takedown, basis `policy`                | `removed` | 410 "removed"                         |
 * | 3 | erased by the guest (or on their request)        | `erased`  | 410 "deleted at your request"         |
 * | 4 | hidden by the event's operator (reversible)      | `hidden`  | 410 "no longer available"             |
 * | 5 | retention ran out (clock or sweep)               | `expired` | 410 "this event has ended"            |
 * | 6 | some file uploaded                               | `live`    | 200                                   |
 * | 7 | nothing uploaded yet                             | `pending` | 200 "on their way"                    |
 *
 * Why this order:
 * - A platform takedown outranks everything, so it can never be undone or papered over by a lesser
 *   state: a session taken down as illegal stays 451 after the guest erases it (the platform's
 *   decision is the one on record, and a quarantined copy is not the guest's to delete), and a
 *   takedown overrides an operator's earlier hide.
 * - Erasure outranks the operator's hide: erasing a hidden session still erases it, and "deleted at
 *   your request" is the true statement about what happened. Erasure also sets `expired_at`, which
 *   is why it has to be checked before expiry.
 * - Hiding outranks expiry: the operator's decision to withhold it stays the reason it is not served,
 *   and the page does not point a guest at the operator's contact for something they pulled.
 * - Only `live` and `pending` serve files. The gallery, the Live Display and the Sharing Station
 *   apply the same rule in SQL (not erased, not hidden or taken down, not expired), so a session a
 *   guest's link refuses is never listed or served anywhere else either.
 */
const { captureSession, event, output } = schema;

export type SessionState = 'pending' | 'live' | 'expired' | 'erased' | 'hidden' | 'removed';

/** What `stateOf` reads off a session row (+ how many of its files are uploaded). */
export interface SessionFacts {
  expiresAt: Date;
  expiredAt: Date | null;
  erasedAt: Date | null;
  /** Set when the session is hidden (`removal: 'operator'`) or taken down by the platform. */
  removedAt?: Date | null;
  removal?: RemovalBasis | null;
  ready: number;
}

export const isExpired = (s: { expiresAt: Date; expiredAt: Date | null }, now = new Date()) =>
  s.expiredAt !== null || s.expiresAt.getTime() <= now.getTime();

/** Why a session is hidden or taken down (a row without a recorded basis counts as a policy takedown). */
export const removalOf = (s: { removedAt?: Date | null; removal?: RemovalBasis | null }): RemovalBasis | null =>
  s.removedAt ? (s.removal ?? 'policy') : null;

/** A takedown by the platform (policy or illegal content), as opposed to the operator's own hide. */
export const isPlatformRemoval = (basis: RemovalBasis | null): basis is 'policy' | 'legal' =>
  basis === 'policy' || basis === 'legal';

/** The state a guest sees: see the table above for the order. */
export function stateOf(s: SessionFacts, now = new Date()): SessionState {
  const removal = removalOf(s);
  if (isPlatformRemoval(removal)) return 'removed';
  if (s.erasedAt) return 'erased';
  if (removal === 'operator') return 'hidden';
  if (isExpired(s, now)) return 'expired';
  return s.ready > 0 ? 'live' : 'pending';
}

/** Only these two states hand a guest their files (or tell them they are on the way). */
export const isServed = (state: SessionState): state is 'live' | 'pending' => state === 'live' || state === 'pending';

/**
 * The HTTP status a link answers in a state: 200 while served, 451 Unavailable For Legal Reasons
 * for a takedown as illegal content, 410 Gone for every other way a session stops being served.
 */
export function stateHttpStatus(state: SessionState, removal: RemovalBasis | null = null): 200 | 410 | 451 {
  if (isServed(state)) return 200;
  return state === 'removed' && removal ? removalHttpStatus(removal) : 410;
}

/** Cheap state check by link id (used by the proxy for the 410/451, and by the "on their way" poller). */
export async function sessionState(linkId: string): Promise<{
  state: SessionState;
  ready: number;
  total: number;
  contact: string;
  /** Why it is hidden or taken down, when `state` is `hidden` or `removed` (451 for `legal`). */
  removal: RemovalBasis | null;
} | null> {
  const [row] = await db()
    .select({
      expiresAt: captureSession.expiresAt,
      expiredAt: captureSession.expiredAt,
      erasedAt: captureSession.erasedAt,
      removedAt: captureSession.removedAt,
      removal: captureSession.removal,
      total: sql<number>`count(${output.id})`.mapWith(Number),
      ready: sql<number>`count(${output.uploadedAt})`.mapWith(Number),
      share: event.shareSettings,
    })
    .from(captureSession)
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .leftJoin(output, eq(output.sessionId, captureSession.id))
    .where(eq(captureSession.linkId, linkId))
    .groupBy(captureSession.id, event.id)
    .limit(1);
  if (!row) return null;
  const state = stateOf(row);
  // DL-12: the operator's contact, for the "this event has ended" page.
  const contact = typeof row.share?.contact === 'string' ? row.share.contact : '';
  return { state, ready: row.ready, total: row.total, contact, removal: removalOf(row) };
}

/** A contact as a link when it is one (email or phone), else plain text. */
export function contactHref(contact: string): string | null {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `mailto:${contact}`;
  if (/^\+?[\d\s().-]{7,}$/.test(contact)) return `tel:${contact.replace(/[^\d+]/g, '')}`;
  return null;
}
