'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, ok, withOperator, type ActionResult } from '@/server/action-result';
import { retryServerRender } from '@/server/render-jobs';

const id = z.uuid();

/**
 * Start a failed server render again (the event dashboard's render queue). A fresh set of tries; the
 * job keeps its place in the record. Refused with a reason when it is not failed, its files have been
 * removed (they are kept a week, and until the guest's link expires), or the booth already asked again.
 */
export async function retryServerRenderAction(eventId: string, jobId: string): Promise<ActionResult> {
  return withOperator({ event: ['update'] }, async (op) => {
    if (!id.safeParse(eventId).success || !id.safeParse(jobId).success) return fail('invalid');
    const result = await retryServerRender(op.organizationId, jobId);
    if (result === 'not_found') return fail('not_found');
    if (result !== 'ok') return fail('conflict', [result]);
    revalidatePath(`/studio/events/${eventId}`);
    return ok(undefined);
  });
}
