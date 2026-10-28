'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { normalizeEmail } from '@immersia/shared';
import { confirmsDeletion } from '@/lib/privacy';
import { fail, ok, withOperator, type ActionResult } from '@/server/action-result';
import { deleteAllContacts, deleteContact, erasePerson, findPerson } from '@/server/guests';
import { deleteOrganization } from '@/server/privacy';
import { allow } from '@/server/rate-limit';

/**
 * Operator-side privacy actions (SHR-6, GDPR/NDPA "deletable on request"). Each one re-checks the
 * session and role on the server: only owners and operators may touch guests' personal data, and
 * only the owner may delete the organization.
 */

const id = z.uuid();
const email = z.string().trim().min(3).max(320);

export async function deleteContactAction(eventId: string, contactId: string): Promise<ActionResult> {
  return withOperator({ guest: ['delete'] }, async (op) => {
    if (!id.safeParse(eventId).success || !id.safeParse(contactId).success) return fail('invalid');
    if (!(await deleteContact(op, eventId, contactId))) return fail('not_found');
    revalidatePath(`/studio/events/${eventId}/guests`);
    return ok(undefined);
  });
}

export async function deleteAllContactsAction(eventId: string): Promise<ActionResult<{ count: number }>> {
  return withOperator({ guest: ['delete'] }, async (op) => {
    if (!id.safeParse(eventId).success) return fail('invalid');
    const count = await deleteAllContacts(op, eventId);
    if (count === null) return fail('not_found');
    revalidatePath(`/studio/events/${eventId}/guests`);
    return ok({ count });
  });
}

export interface PersonView {
  email: string;
  contacts: {
    id: string;
    eventId: string;
    eventName: string;
    eventDate: string;
    consentAt: string;
    sessionCode: string | null;
  }[];
  sessions: number;
}

/** Everything the organization holds under one email address (a read-only preview before deleting). */
export async function findPersonAction(raw: string): Promise<ActionResult<PersonView>> {
  return withOperator({ guest: ['read'] }, async (op) => {
    const parsed = email.safeParse(raw);
    if (!parsed.success || !normalizeEmail(parsed.data).includes('@')) return fail('invalid');
    if (!(await allow('privacyLookupPerOrg', op.organizationId))) return fail('conflict');
    const match = await findPerson(op.organizationId, parsed.data);
    return ok({
      email: match.email,
      sessions: match.sessions,
      contacts: match.contacts.map((c) => ({
        id: c.id,
        eventId: c.eventId,
        eventName: c.eventName,
        eventDate: c.eventDate,
        consentAt: c.consentAt.toISOString(),
        sessionCode: c.sessionCode,
      })),
    });
  });
}

export async function erasePersonAction(
  raw: string,
  withSessions: boolean,
): Promise<ActionResult<{ contacts: number; sessions: number }>> {
  return withOperator({ guest: ['delete'] }, async (op) => {
    const parsed = email.safeParse(raw);
    if (!parsed.success || !normalizeEmail(parsed.data).includes('@')) return fail('invalid');
    if (!(await allow('privacyLookupPerOrg', op.organizationId))) return fail('conflict');
    const result = await erasePerson(op, parsed.data, { withSessions });
    revalidatePath('/studio', 'layout');
    return ok(result);
  });
}

/**
 * Delete the whole organization (owner only). The caller must type the organization's name; the
 * server checks it against the stored name, not the client's. On success the user lands in the
 * studio again, in another organization (a fresh one if this was their only one).
 */
export async function deleteOrganizationAction(typed: string): Promise<ActionResult> {
  const result = await withOperator({ organization: ['delete'] }, async (op) => {
    if (typeof typed !== 'string' || !confirmsDeletion(typed, op.organizationName)) return fail('invalid');
    await deleteOrganization(op);
    return ok(undefined);
  });
  if (result.ok) {
    revalidatePath('/studio', 'layout');
    redirect('/studio');
  }
  return result;
}
