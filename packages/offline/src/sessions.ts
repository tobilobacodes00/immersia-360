import { newLinkId, uuidv7 } from '@immersia/shared';
import type { BoothDB, LocalSession } from './db';

/** Top the pool up below this many codes per event… */
export const CODE_POOL_LOW = 25;
/** …by this many (the server caps a device at 300 unused codes per event). */
export const CODE_POOL_BATCH = 100;

export function codesLeft(db: BoothDB, eventId: string): Promise<number> {
  return db.codes.where('eventId').equals(eventId).count();
}

/**
 * Keep this device's pool of reserved short codes (DL-2) topped up while online, so codes can be
 * handed out with no network. Returns how many were added.
 */
export async function topUpCodes(
  db: BoothDB,
  reserve: (eventId: string, count: number) => Promise<string[]>,
  eventId: string,
): Promise<number> {
  if ((await codesLeft(db, eventId)) >= CODE_POOL_LOW) return 0;
  const codes = await reserve(eventId, CODE_POOL_BATCH);
  const now = Date.now();
  await db.codes.bulkPut(codes.map((code, i) => ({ code, eventId, reservedAt: now + i })));
  return codes.length;
}

/** Take the oldest code from the pool, or null when it is empty (the server then assigns one). */
export function takeCode(db: BoothDB, eventId: string): Promise<string | null> {
  return db.transaction('rw', db.codes, async () => {
    const next = await db.codes
      .where('[eventId+reservedAt]')
      .between([eventId, -Infinity], [eventId, Infinity])
      .first();
    if (!next) return null;
    await db.codes.delete(next.code);
    return next.code;
  });
}

/**
 * Mint a guest session for a just-saved take: its link id (and so its QR) exists immediately,
 * online or not; the upload queue does the rest.
 */
export async function mintSession(
  db: BoothDB,
  s: { eventId: string; takeIds: string[]; capturedAt: number; optedOutOfDisplay?: boolean },
): Promise<LocalSession> {
  const now = Date.now();
  const session: LocalSession = {
    id: uuidv7(now),
    eventId: s.eventId,
    linkId: newLinkId(),
    shortCode: await takeCode(db, s.eventId),
    takeIds: s.takeIds,
    capturedAt: s.capturedAt,
    optedOutOfDisplay: s.optedOutOfDisplay ?? false,
    state: 'local',
    attempts: 0,
    nextAttemptAt: 0, // due at once
    createdAt: now,
    updatedAt: now,
  };
  await db.sessions.put(session);
  return session;
}

export function sessionForTake(db: BoothDB, takeId: string): Promise<LocalSession | undefined> {
  return db.sessions.where('takeIds').equals(takeId).first();
}

/**
 * LIV-8: the guest said "don't show mine on screen" on the result screen. Before registration the
 * flag travels with the registration; after it, the upload queue tells the server (offline-safe).
 */
export async function optOutOfDisplay(db: BoothDB, sessionId: string): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const s = await db.sessions.get(sessionId);
    if (!s || s.optedOutOfDisplay) return;
    const known = s.state !== 'local';
    await db.sessions.update(sessionId, {
      optedOutOfDisplay: true,
      displayOptOutPending: known,
      state: s.state === 'done' ? 'registered' : s.state,
      nextAttemptAt: 0,
      updatedAt: Date.now(),
    });
  });
}

/** SHR-2: queue the session link for an email address; the upload queue sends it once registered. */
export async function queueEmail(db: BoothDB, sessionId: string, email: string): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const s = await db.sessions.get(sessionId);
    if (!s) return;
    const pendingEmails = [...new Set([...(s.pendingEmails ?? []), email.trim().toLowerCase()])];
    await db.sessions.update(sessionId, {
      pendingEmails,
      // A finished session goes back in the queue for this; a failed one stays with the operator.
      state: s.state === 'done' ? 'registered' : s.state,
      nextAttemptAt: 0,
      updatedAt: Date.now(),
    });
  });
}
