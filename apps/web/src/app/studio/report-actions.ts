'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, withOperator, type ActionResult } from '@/server/action-result';
import { hideSession, restoreSession } from '@/server/takedown';

const id = z.uuid();

/**
 * Abuse: the operator hides a reported item at once, without waiting for the platform. It
 * disappears from the share page, the gallery, the Live Display and the Sharing Station together.
 */
export async function hideSessionAction(sessionId: string): Promise<ActionResult> {
  return withOperator({ report: ['hide'] }, async (op) => {
    if (!id.safeParse(sessionId).success) return fail('invalid');
    const result = await hideSession(op, sessionId);
    if (result === 'not_found') return fail('not_found');
    if (result === 'taken_down') return fail('conflict');
    revalidatePath('/studio', 'layout');
    return ok(undefined);
  });
}

/** Undo the operator's own hide. Not available once the platform has taken the item down. */
export async function restoreSessionAction(sessionId: string): Promise<ActionResult> {
  return withOperator({ report: ['hide'] }, async (op) => {
    if (!id.safeParse(sessionId).success) return fail('invalid');
    const result = await restoreSession(op, sessionId);
    if (result === 'not_found') return fail('not_found');
    if (result === 'taken_down') return fail('conflict');
    revalidatePath('/studio', 'layout');
    return ok(undefined);
  });
}
