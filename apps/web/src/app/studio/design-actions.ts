'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isBuiltinId } from '@immersia/layout';
import { templateDocumentSchema } from '@immersia/shared';
import { fail, ok, withOperator, type ActionResult } from '@/server/action-result';
import { mediaPatchSchema, patchMedia } from '@/server/events';
import {
  applyEventDesign,
  deleteLibraryTemplate,
  getTemplate,
  listLibraryTemplates,
  saveTemplate,
  saveToLibrary,
  type TemplateSummary,
} from '@/server/templates';

const id = z.uuid();
const kind = z.enum(['layout', 'overlay']);
const name = z.string().trim().min(1).max(120);

/** Autosave from the editor (screen 6). `conflict`: someone saved a newer version first. */
export async function saveTemplateAction(
  templateId: string,
  doc: unknown,
  baseVersion: string,
): Promise<ActionResult<{ version: string }>> {
  return withOperator({ event: ['update'] }, async (op) => {
    if (!id.safeParse(templateId).success || typeof baseVersion !== 'string') return fail('invalid');
    const res = await saveTemplate(op.organizationId, templateId, doc, baseVersion);
    if (res.ok) return ok({ version: res.version });
    return fail(res.reason, res.issues);
  });
}

/** The stored version and document, for "keep mine" after a conflict and for "reload". */
export async function templateLatestAction(
  templateId: string,
): Promise<ActionResult<{ version: string; doc: unknown }>> {
  return withOperator({ event: ['read'] }, async (op) => {
    if (!id.safeParse(templateId).success) return fail('invalid');
    const t = await getTemplate(op.organizationId, templateId);
    return t ? ok({ version: t.version, doc: t.doc }) : fail('not_found');
  });
}

/** Overlay, intro, outro, music and layout references (screen 5). */
export async function patchMediaAction(eventId: string, patch: unknown): Promise<ActionResult> {
  return withOperator({ event: ['update'] }, async (op) => {
    const parsed = mediaPatchSchema.safeParse(patch);
    if (!id.safeParse(eventId).success || !parsed.success) return fail('invalid');
    const res = await patchMedia(op.organizationId, eventId, parsed.data);
    if (!res.ok) return fail('invalid', res.issues);
    revalidatePath(`/studio/events/${eventId}`, 'layout');
    return ok(undefined);
  });
}

/** Screen 5 "Choose a design": a preset, a saved template or an uploaded overlay becomes the event's. */
export async function applyDesignAction(
  eventId: string,
  templateKind: string,
  doc: unknown,
): Promise<ActionResult<{ templateId: string }>> {
  return withOperator({ event: ['update'] }, async (op) => {
    const k = kind.safeParse(templateKind);
    if (!id.safeParse(eventId).success || !k.success) return fail('invalid');
    const res = await applyEventDesign(op, eventId, k.data, doc);
    if (!res.ok) return fail(res.reason);
    revalidatePath(`/studio/events/${eventId}`, 'layout');
    return ok({ templateId: res.id });
  });
}

export async function listLibraryAction(templateKind: string): Promise<ActionResult<TemplateSummary[]>> {
  return withOperator({ event: ['read'] }, async (op) => {
    const k = kind.safeParse(templateKind);
    if (!k.success) return fail('invalid');
    return ok(await listLibraryTemplates(op.organizationId, k.data));
  });
}

/** "Save as template": the design as the operator sees it, into the organisation's library. */
export async function saveToLibraryAction(
  templateKind: string,
  templateName: string,
  doc: unknown,
): Promise<ActionResult<{ id: string }>> {
  return withOperator({ event: ['update'] }, async (op) => {
    const k = kind.safeParse(templateKind);
    const n = name.safeParse(templateName);
    const d = templateDocumentSchema.safeParse(doc);
    if (!k.success || !n.success || !d.success) return fail('invalid');
    return ok({ id: await saveToLibrary(op, k.data, n.data, d.data) });
  });
}

export async function deleteLibraryTemplateAction(templateId: string): Promise<ActionResult> {
  return withOperator({ event: ['update'] }, async (op) => {
    // The built-in library is code, not rows: it cannot be deleted.
    if (isBuiltinId(templateId)) return fail('forbidden');
    if (!id.safeParse(templateId).success) return fail('invalid');
    return (await deleteLibraryTemplate(op.organizationId, templateId)) ? ok(undefined) : fail('not_found');
  });
}
