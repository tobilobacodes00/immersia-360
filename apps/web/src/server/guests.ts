import 'server-only';
import { and, asc, desc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { normalizeEmail } from '@immersia/shared';
import { audit, emailFingerprint } from './audit';
import { eraseSession } from './erasure';
import type { Operator } from './session';

const { guestContact, event, captureSession } = schema;

/**
 * What an operator does with the people who left their details (SHR-6): see them, search, export,
 * delete one or all, and answer a "delete everything you have on me" request across every event.
 * The operator is the controller of this data; Immersia 360 is their processor. Every query is
 * scoped to the caller's organization through the event, and every deletion is audit-logged.
 */

export const CONTACT_PAGE_SIZE = 50;

export interface ContactRow {
  id: string;
  name: string | null;
  email: string;
  consentAt: Date;
  consentText: string;
  consentLocale: string;
  policyUrl: string;
  /** The session the form was on, or null for the event gallery. */
  sessionId: string | null;
  sessionCode: string | null;
  linkId: string | null;
}

const rowColumns = {
  id: guestContact.id,
  name: guestContact.name,
  email: guestContact.email,
  consentAt: guestContact.consentAt,
  consentText: guestContact.consentText,
  consentLocale: guestContact.consentLocale,
  policyUrl: guestContact.policyUrl,
  sessionId: guestContact.sessionId,
  sessionCode: captureSession.shortCode,
  linkId: captureSession.linkId,
} as const;

const inEvent = (organizationId: string, eventId: string) =>
  and(eq(guestContact.eventId, eventId), eq(event.organizationId, organizationId));

/** Counts for the Guests screen; viewers see these and nothing else. Null when the event isn't theirs. */
export async function contactTotals(
  organizationId: string,
  eventId: string,
): Promise<{ total: number; withName: number } | null> {
  const [owned] = await db()
    .select({ id: event.id })
    .from(event)
    .where(and(eq(event.id, eventId), eq(event.organizationId, organizationId)))
    .limit(1);
  if (!owned) return null;
  const [row] = await db()
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      withName: sql<number>`count(${guestContact.name})`.mapWith(Number),
    })
    .from(guestContact)
    .where(eq(guestContact.eventId, eventId));
  return { total: row?.total ?? 0, withName: row?.withName ?? 0 };
}

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface ContactPage {
  rows: ContactRow[];
  /** Rows matching the search. */
  matching: number;
  page: number;
  pages: number;
}

/** One page of contacts, newest first, optionally narrowed by a name or email search. */
export async function listContacts(
  organizationId: string,
  eventId: string,
  opts: { q?: string; page?: number } = {},
): Promise<ContactPage> {
  const q = opts.q?.trim().slice(0, 100);
  const where = and(
    inEvent(organizationId, eventId),
    q ? or(ilike(guestContact.email, `%${escapeLike(q)}%`), ilike(guestContact.name, `%${escapeLike(q)}%`)) : undefined,
  );
  const [count] = await db()
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(guestContact)
    .innerJoin(event, eq(event.id, guestContact.eventId))
    .where(where);
  const matching = count?.n ?? 0;
  const pages = Math.max(1, Math.ceil(matching / CONTACT_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(opts.page ?? 1) || 1), pages);
  const rows = await db()
    .select(rowColumns)
    .from(guestContact)
    .innerJoin(event, eq(event.id, guestContact.eventId))
    .leftJoin(captureSession, eq(captureSession.id, guestContact.sessionId))
    .where(where)
    .orderBy(desc(guestContact.consentAt), desc(guestContact.id))
    .limit(CONTACT_PAGE_SIZE)
    .offset((page - 1) * CONTACT_PAGE_SIZE);
  return { rows, matching, page, pages };
}

/** Every contact of an event in batches (for the CSV), oldest first, without holding them all in memory. */
export async function* contactBatches(
  organizationId: string,
  eventId: string,
  size = 500,
): AsyncGenerator<ContactRow[]> {
  let cursor: string | null = null;
  for (;;) {
    const rows: ContactRow[] = await db()
      .select(rowColumns)
      .from(guestContact)
      .innerJoin(event, eq(event.id, guestContact.eventId))
      .leftJoin(captureSession, eq(captureSession.id, guestContact.sessionId))
      .where(and(inEvent(organizationId, eventId), cursor ? gt(guestContact.id, cursor) : undefined))
      .orderBy(asc(guestContact.id))
      .limit(size);
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < size) return;
    cursor = rows[rows.length - 1]!.id;
  }
}

/** Delete one contact. The guest's photos and videos are not touched. */
export async function deleteContact(op: Operator, eventId: string, contactId: string): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: event.id })
      .from(event)
      .where(and(eq(event.id, eventId), eq(event.organizationId, op.organizationId)))
      .limit(1);
    if (!owned) return false;
    const [gone] = await tx
      .delete(guestContact)
      .where(and(eq(guestContact.id, contactId), eq(guestContact.eventId, eventId)))
      .returning({ email: guestContact.email });
    if (!gone) return false;
    await audit(
      {
        organizationId: op.organizationId,
        actorUserId: op.userId,
        action: 'guest.contact_deleted',
        target: contactId,
        meta: { eventId, emailRef: emailFingerprint(gone.email) },
      },
      tx,
    );
    return true;
  });
}

/** Delete every contact of an event. Returns how many, or null when the event isn't the organization's. */
export async function deleteAllContacts(op: Operator, eventId: string): Promise<number | null> {
  return db().transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: event.id })
      .from(event)
      .where(and(eq(event.id, eventId), eq(event.organizationId, op.organizationId)))
      .limit(1);
    if (!owned) return null;
    const gone = await tx
      .delete(guestContact)
      .where(eq(guestContact.eventId, eventId))
      .returning({ id: guestContact.id });
    await audit(
      {
        organizationId: op.organizationId,
        actorUserId: op.userId,
        action: 'guest.contacts_deleted_all',
        target: eventId,
        meta: { count: gone.length },
      },
      tx,
    );
    return gone.length;
  });
}

// -----------------------------------------------------------------------------------------------
// A person's data, across every event (the "delete everything you have on me" request)

export interface PersonMatch {
  email: string;
  contacts: {
    id: string;
    eventId: string;
    eventName: string;
    eventDate: string;
    consentAt: Date;
    sessionId: string | null;
    sessionCode: string | null;
  }[];
  /** Distinct sessions (with files still hosted) the person's contacts are attached to. */
  sessions: number;
}

/** Everything held under an email address in this organization. */
export async function findPerson(organizationId: string, rawEmail: string): Promise<PersonMatch> {
  const email = normalizeEmail(rawEmail);
  const contacts = email
    ? await db()
        .select({
          id: guestContact.id,
          eventId: event.id,
          eventName: event.name,
          eventDate: event.date,
          consentAt: guestContact.consentAt,
          sessionId: guestContact.sessionId,
          sessionCode: captureSession.shortCode,
          erasedAt: captureSession.erasedAt,
        })
        .from(guestContact)
        .innerJoin(event, eq(event.id, guestContact.eventId))
        .leftJoin(captureSession, eq(captureSession.id, guestContact.sessionId))
        .where(and(eq(event.organizationId, organizationId), eq(guestContact.email, email)))
        .orderBy(desc(guestContact.consentAt))
    : [];
  const live = new Set(contacts.flatMap((c) => (c.sessionId && !c.erasedAt ? [c.sessionId] : [])));
  return {
    email,
    contacts: contacts.map((c) => ({
      id: c.id,
      eventId: c.eventId,
      eventName: c.eventName,
      eventDate: c.eventDate,
      consentAt: c.consentAt,
      sessionId: c.sessionId,
      sessionCode: c.sessionCode,
    })),
    sessions: live.size,
  };
}

/**
 * Honour a deletion request for one email address: erase the sessions their contacts are attached to
 * (if asked: files, gallery and Live Display entries, and every contact left on those sessions),
 * then delete all their contacts in the organization. Sessions go first, because their link to the
 * person is the contact: if anything fails midway, running it again finds the rest.
 */
export async function erasePerson(
  op: Operator,
  rawEmail: string,
  opts: { withSessions: boolean },
): Promise<{ contacts: number; sessions: number }> {
  const match = await findPerson(op.organizationId, rawEmail);
  if (!match.email || match.contacts.length === 0) return { contacts: 0, sessions: 0 };

  let sessions = 0;
  if (opts.withSessions) {
    const ids = [...new Set(match.contacts.flatMap((c) => (c.sessionId ? [c.sessionId] : [])))];
    for (const sessionId of ids) {
      const done = await eraseSession(
        { sessionId },
        { by: 'operator', userId: op.userId, organizationId: op.organizationId },
      );
      if (done.result === 'erased') sessions++;
    }
  }
  await db()
    .delete(guestContact)
    .where(
      and(
        eq(guestContact.email, match.email),
        inArray(
          guestContact.eventId,
          db().select({ id: event.id }).from(event).where(eq(event.organizationId, op.organizationId)),
        ),
      ),
    );
  await audit({
    organizationId: op.organizationId,
    actorUserId: op.userId,
    action: 'guest.person_erased',
    target: emailFingerprint(match.email),
    meta: { contacts: match.contacts.length, sessions, withSessions: opts.withSessions },
  });
  return { contacts: match.contacts.length, sessions };
}
