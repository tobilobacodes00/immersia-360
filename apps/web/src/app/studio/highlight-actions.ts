'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, withOperator, type ActionResult } from '@/server/action-result';
import {
  completeHighlightUpload,
  createHighlightUpload,
  highlightPlan,
  removeHighlight,
  type HighlightUploadTicket,
} from '@/server/highlights';
import type { HighlightPlan, HighlightSummary } from '@/server/highlights-core';

const id = z.uuid();

/** LIV-14, step 1 of a highlight reel: the gallery's best items for the length asked, with signed links. */
export async function planHighlightAction(eventId: string, input: unknown): Promise<ActionResult<HighlightPlan>> {
  return withOperator({ event: ['update'] }, async (op) => {
    if (!id.safeParse(eventId).success) return fail('invalid');
    return highlightPlan(op.organizationId, eventId, input);
  });
}

/** Publishing the reel, step 1: validates what the browser built and returns presigned uploads. */
export async function startHighlightUploadAction(
  eventId: string,
  input: unknown,
): Promise<ActionResult<HighlightUploadTicket>> {
  return withOperator({ event: ['update'] }, async (op) => {
    if (!id.safeParse(eventId).success) return fail('invalid');
    return createHighlightUpload(op, eventId, input);
  });
}

/** Step 2: checks the stored file really is the MP4 that was declared, then puts it at the top of the gallery. */
export async function completeHighlightUploadAction(
  eventId: string,
  highlightId: string,
): Promise<ActionResult<HighlightSummary>> {
  return withOperator({ event: ['update'] }, async (op) => {
    if (!id.safeParse(eventId).success || !id.safeParse(highlightId).success) return fail('invalid');
    const res = await completeHighlightUpload(op, eventId, highlightId);
    if (res.ok) revalidatePath(`/studio/events/${eventId}`);
    return res;
  });
}

/** Takes the reel off the client gallery and deletes its files. */
export async function removeHighlightAction(eventId: string): Promise<ActionResult> {
  return withOperator({ event: ['update'] }, async (op) => {
    if (!id.safeParse(eventId).success) return fail('invalid');
    const res = await removeHighlight(op, eventId);
    if (res.ok) revalidatePath(`/studio/events/${eventId}`);
    return res;
  });
}
