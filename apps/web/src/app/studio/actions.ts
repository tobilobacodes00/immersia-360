'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createEventSchema, registerDeviceSchema } from '@immersia/shared';
import { fail, ok, withOperator, type ActionResult } from '@/server/action-result';
import {
  createEvent,
  duplicateEvent,
  extendGuestFiles,
  setArchived,
  updateBasics,
  updateSection,
  type EventBasicsPatch,
} from '@/server/events';
import { registerDevice, renameDevice, revokeDevice } from '@/server/devices';

const id = z.uuid();

export async function createEventAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return withOperator({ event: ['create'] }, async (op) => {
    const parsed = createEventSchema.safeParse(input);
    if (!parsed.success)
      return fail(
        'invalid',
        parsed.error.issues.map((i) => i.message),
      );
    const eventId = await createEvent(op, parsed.data);
    revalidatePath('/studio', 'layout');
    return ok({ id: eventId });
  });
}

export async function duplicateEventAction(eventId: string, name: string): Promise<ActionResult<{ id: string }>> {
  return withOperator({ event: ['create'] }, async (op) => {
    const n = z.string().trim().min(1).max(120).safeParse(name);
    if (!id.safeParse(eventId).success || !n.success) return fail('invalid');
    const copy = await duplicateEvent(op, eventId, n.data);
    if (!copy) return fail('not_found');
    revalidatePath('/studio', 'layout');
    return ok({ id: copy });
  });
}

export async function setArchivedAction(eventId: string, archived: boolean): Promise<ActionResult> {
  return withOperator({ event: ['archive'] }, async (op) => {
    if (!id.safeParse(eventId).success) return fail('invalid');
    if (!(await setArchived(op.organizationId, eventId, archived))) return fail('not_found');
    revalidatePath('/studio', 'layout');
    return ok(undefined);
  });
}

const basicsSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    date: z.iso.date(),
    mode: z.enum(['video360', 'photo']),
    expiryDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
    filenamePrefixEnabled: z.boolean(),
    liveDisplayEnabled: z.boolean(),
    moderation: z.enum(['auto', 'approve']),
  })
  .partial()
  .strict();

export async function updateBasicsAction(eventId: string, patch: EventBasicsPatch): Promise<ActionResult> {
  return withOperator({ event: ['update'] }, async (op) => {
    const parsed = basicsSchema.safeParse(patch);
    if (!id.safeParse(eventId).success || !parsed.success) return fail('invalid');
    if (!(await updateBasics(op.organizationId, eventId, parsed.data))) return fail('not_found');
    revalidatePath(`/studio/events/${eventId}`, 'layout');
    return ok(undefined);
  });
}

export async function updateSectionAction(
  eventId: string,
  section: 'outputSettings' | 'shareSettings' | 'branding',
  value: unknown,
): Promise<ActionResult> {
  return withOperator({ event: ['update'] }, async (op) => {
    if (!id.safeParse(eventId).success || !['outputSettings', 'shareSettings', 'branding'].includes(section))
      return fail('invalid');
    const res = await updateSection(op.organizationId, eventId, section, value);
    if (!res.ok) return fail('invalid', res.issues);
    revalidatePath(`/studio/events/${eventId}`, 'layout');
    return ok(undefined);
  });
}

export async function registerDeviceAction(input: unknown): Promise<ActionResult<{ id: string; token: string }>> {
  return withOperator({ device: ['register'] }, async (op) => {
    const parsed = registerDeviceSchema.safeParse(input);
    if (!parsed.success)
      return fail(
        'invalid',
        parsed.error.issues.map((i) => i.message),
      );
    const created = await registerDevice(op, parsed.data);
    revalidatePath('/studio/devices');
    return ok(created);
  });
}

export async function renameDeviceAction(deviceId: string, name: string): Promise<ActionResult> {
  return withOperator({ device: ['register'] }, async (op) => {
    const n = z.string().trim().min(1).max(60).safeParse(name);
    if (!id.safeParse(deviceId).success || !n.success) return fail('invalid');
    if (!(await renameDevice(op.organizationId, deviceId, n.data))) return fail('not_found');
    revalidatePath('/studio/devices');
    return ok(undefined);
  });
}

export async function revokeDeviceAction(deviceId: string): Promise<ActionResult> {
  return withOperator({ device: ['revoke'] }, async (op) => {
    if (!id.safeParse(deviceId).success) return fail('invalid');
    if (!(await revokeDevice(op.organizationId, deviceId))) return fail('not_found');
    revalidatePath('/studio/devices');
    return ok(undefined);
  });
}

/** DL-12: extend the event's live guest links by 7 or 30 days. */
export async function extendGuestFilesAction(
  eventId: string,
  days: number,
): Promise<ActionResult<{ extended: number }>> {
  return withOperator({ event: ['update'] }, async (op) => {
    if (!id.safeParse(eventId).success || (days !== 7 && days !== 30)) return fail('invalid');
    const extended = await extendGuestFiles(op.organizationId, eventId, days);
    if (extended === null) return fail('not_found');
    revalidatePath(`/studio/events/${eventId}`);
    return ok({ extended });
  });
}
