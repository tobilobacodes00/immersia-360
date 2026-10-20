import 'server-only';
import { createHmac } from 'node:crypto';
import { db, schema, type Database } from '@immersia/db';
import { uuidv7 } from '@immersia/shared';
import { env } from './env';

/**
 * The audit log (privacy accountability): who deleted or exported personal data, and when. Entries
 * never contain the personal data they are about: a guest's address is recorded as a keyed hash,
 * which lets an operator confirm a later "was my data deleted?" question without the log itself
 * becoming a second copy of what was erased.
 */
export type AuditAction =
  | 'guest.contact_deleted'
  | 'guest.contacts_deleted_all'
  | 'guest.contacts_exported'
  | 'guest.person_erased'
  | 'guest.session_erased'
  | 'organization.exported'
  | 'organization.deleted';

export interface AuditEntry {
  /** Null once the organization itself is gone (the row would cascade away with it). */
  organizationId: string | null;
  actorUserId?: string | null;
  action: AuditAction;
  target?: string | null;
  meta?: Record<string, unknown>;
}

/** Write an entry; pass `tx` to make it part of the transaction that did the work. */
export async function audit(entry: AuditEntry, tx?: Pick<Database, 'insert'>): Promise<void> {
  await (tx ?? db()).insert(schema.auditLog).values({
    id: uuidv7(),
    organizationId: entry.organizationId,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    target: entry.target ?? null,
    meta: entry.meta ?? {},
  });
}

/** A stable, keyed fingerprint of an email address for the log (not reversible without the secret). */
export function emailFingerprint(email: string): string {
  return createHmac('sha256', `immersia-audit:${env().BETTER_AUTH_SECRET}`)
    .update(email.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
}
