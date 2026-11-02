import 'server-only';
import { createHmac } from 'node:crypto';
import { db, schema, type Database } from '@immersia/db';
import { uuidv7 } from '@immersia/shared';
import { env } from './env';

/**
 * The audit log: who did what, to what, when. Written for everything that touches personal data
 * (privacy accountability: who deleted or exported it) and for every decision that changes what
 * guests can see (reports decided, sessions hidden or restored, takedowns) or what the platform
 * records (the cost entered for a month). The acting user is null when the system acted (an
 * automatic scan, a guest erasing their own session).
 *
 * Entries never contain the personal data or the content they are about: a guest's address is
 * recorded as a keyed hash, which lets an operator confirm a later "was my data deleted?" question
 * without the log itself becoming a second copy of what was erased, and everything else is ids.
 */
export type AuditAction =
  // privacy (SHR-6)
  | 'guest.contact_deleted'
  | 'guest.contacts_deleted_all'
  | 'guest.contacts_exported'
  | 'guest.person_erased'
  | 'guest.session_erased'
  | 'organization.exported'
  | 'organization.deleted'
  // reports and takedowns
  | 'report.takedown'
  | 'report.dismiss'
  | 'report.escalate'
  | 'report.escalate_hold'
  | 'scan.flagged'
  | 'session.hide'
  | 'session.restore'
  // platform administration
  | 'cost.set'
  | 'cost.delete';

export interface AuditEntry {
  /**
   * The organization the action concerns, so its owners can see it. Null for platform-wide actions,
   * and once the organization itself is gone (the row would cascade away with it).
   */
  organizationId?: string | null;
  /** The signed-in user who acted; null when the system (or an anonymous guest) did. */
  actorUserId?: string | null;
  action: AuditAction;
  /** The row acted on, e.g. `session:<id>`, `report:<id>` or `month:<yyyy-mm-dd>`. */
  target?: string | null;
  meta?: Record<string, unknown>;
}

/** Write an entry; pass `tx` to make it part of the transaction that did the work. */
export async function audit(entry: AuditEntry, tx?: Pick<Database, 'insert'>): Promise<void> {
  await (tx ?? db()).insert(schema.auditLog).values({
    id: uuidv7(),
    organizationId: entry.organizationId ?? null,
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
