import 'server-only';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import type { RemovalBasis } from '@immersia/shared';
import { audit } from './audit';
import { appOrigin } from './env';
import { refreshSessionItem, withdrawSession } from './live';
import { deleteObjects, quarantineObjects } from './storage';

const { captureSession, event, output, uploadObject } = schema;

/**
 * Taking a guest session out of service (PRD Abuse NFR: a 24-hour takedown process).
 *
 * A session has one place that says whether it is served: `capture_session.removed_at`. Every
 * public surface checks it (the share page and its downloads answer 451 or 410, the event gallery
 * and its ZIP leave it out, the Live Display and the Sharing Station drop it), so setting it is what
 * "hidden everywhere at once" means; the hub is told as well so connected screens react within a
 * second. On top of that the platform deletes the hosted files (policy) or quarantines them
 * (illegal content: kept out of reach, but not destroyed). The operator's own Drive or Dropbox
 * copies are theirs and are never touched.
 */

export type TakedownResult = { ok: true; objects: number } | { ok: false; error: 'not_found' | 'storage_failed' };

/**
 * The platform takes a session down. Idempotent: calling it again on a session already taken down
 * (a retry after the storage step failed) repeats only what is left. `legal` is final and wins over
 * `policy`. Throws nothing: a storage failure is reported, with the session already hidden.
 */
export async function takeDownSession(input: {
  sessionId: string;
  basis: Exclude<RemovalBasis, 'operator'>;
  /** The admin, or null when the system acted (an automatic scan). */
  actorUserId: string | null;
  /** The audit entry: `report.takedown`, `report.escalate_hold`, `scan.flagged`… */
  auditAction: string;
  meta?: Record<string, unknown>;
}): Promise<TakedownResult> {
  const [row] = await db()
    .select({
      id: captureSession.id,
      eventId: captureSession.eventId,
      organizationId: event.organizationId,
      removedAt: captureSession.removedAt,
      removal: captureSession.removal,
    })
    .from(captureSession)
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(eq(captureSession.id, input.sessionId))
    .limit(1);
  if (!row) return { ok: false, error: 'not_found' };
  const basis: Exclude<RemovalBasis, 'operator'> = row.removal === 'legal' ? 'legal' : input.basis;

  const outputs = await db()
    .select({ id: output.id, key: output.objectKey })
    .from(output)
    .where(eq(output.sessionId, row.id));
  await db().transaction(async (tx) => {
    await tx
      .update(captureSession)
      .set({ removedAt: row.removedAt ?? new Date(), removal: basis, removedBy: input.actorUserId })
      .where(eq(captureSession.id, row.id));
    // Copies to the operator's cloud that have not happened do not happen. Finished ones are theirs.
    if (outputs.length)
      await tx.delete(uploadObject).where(
        and(
          inArray(uploadObject.target, ['drive', 'dropbox']),
          ne(uploadObject.status, 'done'),
          inArray(
            uploadObject.outputId,
            outputs.map((o) => o.id),
          ),
        ),
      );
    await audit(
      {
        organizationId: row.organizationId,
        actorUserId: input.actorUserId,
        action: input.auditAction,
        target: `session:${row.id}`,
        meta: { basis, ...input.meta },
      },
      tx,
    );
  });

  // Off every connected screen now; the database already keeps it off the next feed read.
  await withdrawSession(row.eventId, row.id);

  const keys = outputs.flatMap((o) => (o.key ? [o.key] : []));
  try {
    if (keys.length) {
      if (basis === 'legal') await quarantineObjects(keys);
      else await deleteObjects(keys);
    }
  } catch (err) {
    console.error('[takedown] storage step failed', row.id, err instanceof Error ? err.name : err);
    return { ok: false, error: 'storage_failed' };
  }
  return { ok: true, objects: keys.length };
}

export type HideResult = 'ok' | 'not_found' | 'taken_down' | 'not_hidden';

/**
 * The event's operator hides a guest's session immediately, without waiting for the platform (for
 * example while a report is looked at). Their own control: nothing is deleted, and they can restore
 * it, unless the platform has since taken it down.
 */
export async function hideSession(
  op: { organizationId: string; userId: string },
  sessionId: string,
): Promise<HideResult> {
  const [row] = await db()
    .select({
      id: captureSession.id,
      eventId: captureSession.eventId,
      removedAt: captureSession.removedAt,
      removal: captureSession.removal,
    })
    .from(captureSession)
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(and(eq(captureSession.id, sessionId), eq(event.organizationId, op.organizationId)))
    .limit(1);
  if (!row) return 'not_found';
  if (row.removedAt && row.removal !== 'operator') return 'taken_down';
  await db().transaction(async (tx) => {
    await tx
      .update(captureSession)
      .set({ removedAt: row.removedAt ?? new Date(), removal: 'operator', removedBy: op.userId })
      .where(eq(captureSession.id, row.id));
    await audit(
      {
        organizationId: op.organizationId,
        actorUserId: op.userId,
        action: 'session.hide',
        target: `session:${row.id}`,
      },
      tx,
    );
  });
  await withdrawSession(row.eventId, row.id);
  return 'ok';
}

/** Undo the operator's own hide. A platform takedown is not theirs to undo. */
export async function restoreSession(
  op: { organizationId: string; userId: string },
  sessionId: string,
): Promise<HideResult> {
  const [row] = await db()
    .select({ id: captureSession.id, removedAt: captureSession.removedAt, removal: captureSession.removal })
    .from(captureSession)
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(and(eq(captureSession.id, sessionId), eq(event.organizationId, op.organizationId)))
    .limit(1);
  if (!row) return 'not_found';
  if (!row.removedAt) return 'not_hidden';
  if (row.removal !== 'operator') return 'taken_down';
  await db().transaction(async (tx) => {
    await tx
      .update(captureSession)
      .set({ removedAt: null, removal: null, removedBy: null })
      .where(eq(captureSession.id, row.id));
    await audit(
      {
        organizationId: op.organizationId,
        actorUserId: op.userId,
        action: 'session.restore',
        target: `session:${row.id}`,
      },
      tx,
    );
  });
  // Back on the Live Display if it was there before (the usual rules decide: approval, opt-out…).
  await refreshSessionItem(row.id, appOrigin());
  return 'ok';
}
