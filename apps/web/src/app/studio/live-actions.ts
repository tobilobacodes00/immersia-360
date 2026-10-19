'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { DISPLAY_LAYOUTS, displaySettingsSchema } from '@immersia/shared';
import { fail, ok, withOperator, type ActionResult } from '@/server/action-result';
import { appOrigin } from '@/server/env';
import {
  createPairing,
  isOnline,
  listDisplays,
  moderate,
  moderationLists,
  removeDisplay,
  setLiveOptions,
  updateDisplay,
  type QueueEntry,
} from '@/server/live';

const id = z.uuid();

export interface DisplaySummary {
  id: string;
  name: string;
  layout: (typeof DISPLAY_LAYOUTS)[number];
  settings: z.infer<typeof displaySettingsSchema>;
  online: boolean;
  lastSeenAt: string | null;
}

/** LIV-1: a fresh pairing code for a TV (ten minutes). */
export async function createPairingAction(eventId: string): Promise<ActionResult<{ code: string; expiresAt: string }>> {
  return withOperator({ event: ['update'] }, async (op) => {
    if (!id.safeParse(eventId).success) return fail('invalid');
    const pairing = await createPairing(op, eventId);
    return pairing ? ok({ code: pairing.code, expiresAt: pairing.expiresAt.toISOString() }) : fail('not_found');
  });
}

export async function listDisplaysAction(eventId: string): Promise<ActionResult<DisplaySummary[]>> {
  return withOperator({ event: ['read'] }, async (op) => {
    if (!id.safeParse(eventId).success) return fail('invalid');
    const rows = await listDisplays(op.organizationId, eventId);
    return ok(
      rows.map((d) => ({
        id: d.id,
        name: d.name,
        layout: d.layout,
        settings: displaySettingsSchema.parse(d.settings),
        online: isOnline(d),
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      })),
    );
  });
}

const displayPatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  layout: z.enum(DISPLAY_LAYOUTS).optional(),
  settings: displaySettingsSchema.partial().optional(),
});

/** LIV-3, LIV-10, LIV-11: layout and playback, per display, applied on the TV within a second. */
export async function updateDisplayAction(displayId: string, patch: unknown): Promise<ActionResult> {
  return withOperator({ event: ['update'] }, async (op) => {
    const p = displayPatch.safeParse(patch);
    if (!id.safeParse(displayId).success || !p.success) return fail('invalid');
    return (await updateDisplay(op.organizationId, displayId, p.data)) ? ok(undefined) : fail('not_found');
  });
}

export async function removeDisplayAction(displayId: string): Promise<ActionResult> {
  return withOperator({ event: ['update'] }, async (op) => {
    if (!id.safeParse(displayId).success) return fail('invalid');
    return (await removeDisplay(op.organizationId, displayId)) ? ok(undefined) : fail('not_found');
  });
}

const options = z.object({ enabled: z.boolean().optional(), moderation: z.enum(['auto', 'approve']).optional() });

export async function setLiveOptionsAction(eventId: string, patch: unknown): Promise<ActionResult> {
  return withOperator({ event: ['update'] }, async (op) => {
    const p = options.safeParse(patch);
    if (!id.safeParse(eventId).success || !p.success) return fail('invalid');
    if (!(await setLiveOptions(op.organizationId, eventId, p.data))) return fail('not_found');
    revalidatePath(`/studio/events/${eventId}`, 'layout');
    return ok(undefined);
  });
}

export async function moderationListsAction(
  eventId: string,
): Promise<ActionResult<{ pending: QueueEntry[]; shown: QueueEntry[]; hidden: QueueEntry[] }>> {
  return withOperator({ event: ['read'] }, async (op) => {
    if (!id.safeParse(eventId).success) return fail('invalid');
    const lists = await moderationLists(op.organizationId, eventId, appOrigin());
    return lists ? ok(lists) : fail('not_found');
  });
}

/** LIV-7: approve an item (or put a hidden one back), or hide one from every screen at once. */
export async function moderateAction(sessionId: string, action: unknown): Promise<ActionResult> {
  return withOperator({ event: ['update'] }, async (op) => {
    const a = z.enum(['show', 'hide']).safeParse(action);
    if (!id.safeParse(sessionId).success || !a.success) return fail('invalid');
    return (await moderate(op.organizationId, sessionId, a.data, appOrigin())) ? ok(undefined) : fail('not_found');
  });
}
