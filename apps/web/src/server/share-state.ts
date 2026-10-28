import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';

/**
 * Session state by link id. Kept apart from share.ts (no storage SDK) because the proxy imports it
 * for the 410 on expired links (DL-9).
 */
const { captureSession, event, output } = schema;

/** `erased`: the guest (or an operator on their request) deleted it; `expired`: its retention ran out. */
export type SessionState = 'pending' | 'live' | 'expired' | 'erased';

export const isExpired = (s: { expiresAt: Date; expiredAt: Date | null }, now = new Date()) =>
  s.expiredAt !== null || s.expiresAt.getTime() <= now.getTime();

/** The state a guest sees. Erasure wins over expiry: "deleted at your request" is the more specific answer. */
export function stateOf(
  s: { expiresAt: Date; expiredAt: Date | null; erasedAt: Date | null; ready: number },
  now = new Date(),
): SessionState {
  if (s.erasedAt) return 'erased';
  if (isExpired(s, now)) return 'expired';
  return s.ready > 0 ? 'live' : 'pending';
}

/** Cheap state check by link id (used by the proxy for the 410, and by the "on their way" poller). */
export async function sessionState(
  linkId: string,
): Promise<{ state: SessionState; ready: number; total: number; contact: string } | null> {
  const [row] = await db()
    .select({
      expiresAt: captureSession.expiresAt,
      expiredAt: captureSession.expiredAt,
      erasedAt: captureSession.erasedAt,
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
  return { state, ready: row.ready, total: row.total, contact };
}

/** A contact as a link when it is one (email or phone), else plain text. */
export function contactHref(contact: string): string | null {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `mailto:${contact}`;
  if (/^\+?[\d\s().-]{7,}$/.test(contact)) return `tel:${contact.replace(/[^\d+]/g, '')}`;
  return null;
}
