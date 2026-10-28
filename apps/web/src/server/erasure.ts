import 'server-only';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { track } from './analytics';
import { audit } from './audit';
import { cancelPendingCopies } from './cloud/copy';
import { erasurePlan, purgeStage } from './erasure-core';
import { withdrawSession } from './live';
import { deleteObjects } from './storage';

const { captureSession, event, output, guestContact, take } = schema;

/**
 * Erasing a guest session (GDPR Art. 17 / NDPA "deletable on request"): the guest holding the link,
 * or an operator acting on a guest's request, removes the session for good.
 *
 * What happens, in order:
 * 1. One transaction marks the session erased (and expired, which is what every listing, the Live
 *    Display feed and the sweeps already filter on), deletes the contacts the guest left on it,
 *    and writes the audit entry. From this moment the link answers "deleted at your request" and a
 *    booth can no longer upload to it.
 * 2. The files are deleted from storage and the Live Display is told to drop the item.
 * 3. The output rows stay for two more hours (their keys are the only record of what a booth with a
 *    signed upload URL could still write); the sweep deletes the keys again and then the rows.
 *
 * Every step is safe to repeat, so a crash anywhere is finished by the next request or the sweep.
 */
export type Eraser = { by: 'guest' } | { by: 'operator'; userId: string; organizationId: string };

export interface EraseOutcome {
  result: 'erased' | 'already' | 'not_found';
  sessionId: string | null;
  contacts: number;
  outputs: number;
}

export async function eraseSession(
  target: { linkId: string } | { sessionId: string },
  eraser: Eraser,
): Promise<EraseOutcome> {
  const now = new Date();
  const done = await db().transaction(async (tx) => {
    const match =
      'linkId' in target ? eq(captureSession.linkId, target.linkId) : eq(captureSession.id, target.sessionId);
    const [row] = await tx
      .select({
        id: captureSession.id,
        eventId: captureSession.eventId,
        organizationId: event.organizationId,
        liveDisplay: event.liveDisplayEnabled,
        displayStatus: captureSession.displayStatus,
        erasedAt: captureSession.erasedAt,
        expiredAt: captureSession.expiredAt,
      })
      .from(captureSession)
      .innerJoin(event, eq(event.id, captureSession.eventId))
      .where(and(match, eraser.by === 'operator' ? eq(event.organizationId, eraser.organizationId) : undefined))
      .limit(1)
      .for('update', { of: captureSession });
    if (!row) return { kind: 'not_found' as const };

    const plan = erasurePlan(row, now);
    if (plan.already) return { kind: 'already' as const, sessionId: row.id };

    await tx.update(captureSession).set(plan.patch).where(eq(captureSession.id, row.id));
    const contacts = await tx
      .delete(guestContact)
      .where(eq(guestContact.sessionId, row.id))
      .returning({ id: guestContact.id });
    const outputs = await tx
      .update(output)
      // Not downloadable any more; the row stays only until the sweep has deleted the key for good.
      .set({ uploadedAt: null })
      .where(eq(output.sessionId, row.id))
      .returning({ key: output.objectKey });
    // Copies to the operator's cloud that have not happened do not happen (finished ones are theirs).
    await cancelPendingCopies(tx, row.id);
    await audit(
      {
        organizationId: row.organizationId,
        actorUserId: eraser.by === 'operator' ? eraser.userId : null,
        action: 'guest.session_erased',
        target: row.id,
        meta: { by: eraser.by, eventId: row.eventId, contacts: contacts.length, outputs: outputs.length },
      },
      tx,
    );
    return {
      kind: 'erased' as const,
      sessionId: row.id,
      eventId: row.eventId,
      onScreen: row.liveDisplay && row.displayStatus !== 'opted_out',
      keys: outputs.flatMap((o) => (o.key ? [o.key] : [])),
      contacts: contacts.length,
      outputs: outputs.length,
    };
  });

  if (done.kind === 'not_found') return { result: 'not_found', sessionId: null, contacts: 0, outputs: 0 };
  if (done.kind === 'already') return { result: 'already', sessionId: done.sessionId, contacts: 0, outputs: 0 };

  // Past the point of no return: the session is gone for guests. Cleanup failures are logged and
  // finished by the hourly sweep (purgeErasedSessions), never surfaced as a failed erasure.
  if (done.keys.length)
    await deleteObjects(done.keys).catch((err: unknown) =>
      console.error('[erasure] file delete failed, the sweep will retry', err instanceof Error ? err.message : err),
    );
  if (done.onScreen) await withdrawSession(done.eventId, done.sessionId);
  track({ name: 'guest_data_erased', by: eraser.by }, { eventId: done.eventId });
  return { result: 'erased', sessionId: done.sessionId, contacts: done.contacts, outputs: done.outputs };
}

/**
 * The sweep for erased sessions (run by the hourly cron). Deletes the keys of every erased session
 * that still has output rows (catching files a booth uploaded with a signed URL issued before the
 * erasure), and once two hours have passed drops the rows and the takes they came from.
 */
export async function purgeErasedSessions(limit = 100): Promise<{ sessions: number; objects: number; rows: number }> {
  const due = await db()
    .select({ id: captureSession.id, erasedAt: captureSession.erasedAt })
    .from(captureSession)
    .where(
      and(
        isNotNull(captureSession.erasedAt),
        sql`exists (select 1 from ${output} o where o.session_id = ${captureSession.id})`,
      ),
    )
    .orderBy(asc(captureSession.erasedAt))
    .limit(limit);
  let objects = 0;
  let rows = 0;
  for (const s of due) {
    try {
      const outputs = await db()
        .select({ key: output.objectKey, takeId: output.takeId })
        .from(output)
        .where(eq(output.sessionId, s.id));
      const keys = outputs.flatMap((o) => (o.key ? [o.key] : []));
      if (keys.length) objects += await deleteObjects(keys);
      if (purgeStage(s.erasedAt!) !== 'rows') continue;
      const removed = await db().delete(output).where(eq(output.sessionId, s.id)).returning({ id: output.id });
      rows += removed.length;
      const takeIds = [...new Set(outputs.flatMap((o) => (o.takeId ? [o.takeId] : [])))];
      if (takeIds.length)
        await db()
          .delete(take)
          .where(
            and(inArray(take.id, takeIds), sql`not exists (select 1 from ${output} o where o.take_id = ${take.id})`),
          );
    } catch (err) {
      console.error('[erasure] sweep failed for a session', s.id, err instanceof Error ? err.message : err);
    }
  }
  return { sessions: due.length, objects, rows };
}
