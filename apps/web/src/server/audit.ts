import 'server-only';
import { db, schema, type Transaction } from '@immersia/db';
import { uuidv7 } from '@immersia/shared';

/**
 * The audit log: who did what, to what, when. Written for every decision that changes what guests
 * can see (reports actioned, sessions hidden or restored) and every administrative change, with the
 * acting user (null for the system, e.g. an automatic scan). Never holds guest content, only ids.
 */
export interface AuditEntry {
  /** The organization the action concerns, so its owners can see it. Null for platform-wide actions. */
  organizationId?: string | null;
  /** The signed-in user who acted; null when the system did. */
  actorUserId?: string | null;
  /** `report.takedown`, `report.dismiss`, `session.hide`, `cost.set`… */
  action: string;
  /** The row acted on, e.g. `session:<id>` or `report:<id>`. */
  target?: string | null;
  meta?: Record<string, unknown>;
}

export async function audit(entry: AuditEntry, tx?: Transaction): Promise<void> {
  const row = {
    id: uuidv7(),
    organizationId: entry.organizationId ?? null,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    target: entry.target ?? null,
    meta: entry.meta ?? {},
  };
  if (tx) await tx.insert(schema.auditLog).values(row);
  else await db().insert(schema.auditLog).values(row);
}
