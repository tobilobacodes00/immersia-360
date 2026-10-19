import 'server-only';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import {
  brandingSchema,
  canvasSizeFor,
  outputSettingsSchema,
  overlayCanvasFor,
  templateDocumentSchema,
  uuidv7,
  type TemplateDocument,
} from '@immersia/shared';
import { fitDocument, overlayPreset, presetTemplate, type Shots } from '@immersia/layout';
import type { Operator } from './session';

const { event, template } = schema;

export type TemplateKind = (typeof template.$inferSelect)['kind'];

export interface TemplateRecord {
  id: string;
  kind: TemplateKind;
  name: string;
  eventId: string | null;
  doc: TemplateDocument;
  /** Optimistic-concurrency token: a save must name the version it was based on. */
  version: string;
}

const toRecord = (row: typeof template.$inferSelect): TemplateRecord => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  eventId: row.eventId,
  doc: { canvas: row.canvas, elements: row.elements },
  version: row.updatedAt.toISOString(),
});

/** The canvas an event needs for each kind: its print size (layouts) or its video aspect (overlays). */
export function targetCanvas(kind: TemplateKind, output: ReturnType<typeof outputSettingsSchema.parse>) {
  return kind === 'layout' ? canvasSizeFor(output.photo.printSize) : overlayCanvasFor(output.video360.aspect);
}

/** A template the organisation may read: its own, or the built-in library (organization_id null). */
export async function getTemplate(organizationId: string, id: string): Promise<TemplateRecord | null> {
  const [row] = await db()
    .select()
    .from(template)
    .where(
      and(
        eq(template.id, id),
        sql`(${template.organizationId} = ${organizationId} or ${template.organizationId} is null)`,
      ),
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

/**
 * The event's working layout or overlay (screen 6). The first time, it is created from the preset
 * that matches the event (print size and shots, or the video aspect, in the event's theme) and the
 * event is pointed at it, in one transaction so two tabs can't create two.
 */
export async function ensureEventTemplate(
  op: Operator,
  eventId: string,
  kind: TemplateKind,
): Promise<TemplateRecord | null> {
  return db().transaction(async (tx) => {
    const [ev] = await tx
      .select()
      .from(event)
      .where(and(eq(event.id, eventId), eq(event.organizationId, op.organizationId)))
      .for('update');
    if (!ev) return null;
    const output = outputSettingsSchema.parse(ev.outputSettings);
    const currentId = kind === 'layout' ? output.photo.layoutTemplateId : output.video360.overlayTemplateId;
    if (currentId) {
      const [row] = await tx
        .select()
        .from(template)
        .where(and(eq(template.id, currentId), eq(template.eventId, eventId)))
        .limit(1);
      if (row) return toRecord(row);
    }
    const theme = brandingSchema.parse(ev.branding).theme;
    const doc =
      kind === 'layout'
        ? presetTemplate(output.photo.printSize, {
            shots: output.photo.shots as Shots,
            background: theme.background,
            ink: theme.ink,
            font: theme.font,
          })
        : overlayPreset(output.video360.aspect, 'band', theme);
    const id = uuidv7();
    const [row] = await tx
      .insert(template)
      .values({
        id,
        organizationId: op.organizationId,
        eventId,
        kind,
        name: ev.name,
        canvas: doc.canvas,
        elements: doc.elements,
        // Millisecond precision (not the column default now()), so the version round-trips exactly.
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    const next =
      kind === 'layout'
        ? { ...output, photo: { ...output.photo, layoutTemplateId: id } }
        : { ...output, video360: { ...output.video360, overlayTemplateId: id } };
    await tx.update(event).set({ outputSettings: next }).where(eq(event.id, eventId));
    return toRecord(row!);
  });
}

export type SaveResult =
  { ok: true; version: string } | { ok: false; reason: 'not_found' | 'conflict' | 'invalid'; issues?: string[] };

/**
 * Save a document the operator edited. `baseVersion` must still be current: if another tab or
 * device saved in between, nothing is overwritten and the editor offers to reload.
 */
export async function saveTemplate(
  organizationId: string,
  id: string,
  input: unknown,
  baseVersion: string,
): Promise<SaveResult> {
  const parsed = templateDocumentSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      reason: 'invalid',
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  const base = new Date(baseVersion);
  if (Number.isNaN(base.getTime())) return { ok: false, reason: 'invalid' };
  const now = new Date(Math.max(Date.now(), base.getTime() + 1));
  const rows = await db()
    .update(template)
    .set({ canvas: parsed.data.canvas, elements: parsed.data.elements, updatedAt: now })
    .where(
      and(
        eq(template.id, id),
        eq(template.organizationId, organizationId),
        // Versions are millisecond ISO strings; rows created by the database carry microseconds.
        sql`date_trunc('milliseconds', ${template.updatedAt}) = ${base}`,
      ),
    )
    .returning({ updatedAt: template.updatedAt });
  if (rows[0]) return { ok: true, version: rows[0].updatedAt.toISOString() };
  const [exists] = await db()
    .select({ id: template.id })
    .from(template)
    .where(and(eq(template.id, id), eq(template.organizationId, organizationId)))
    .limit(1);
  return { ok: false, reason: exists ? 'conflict' : 'not_found' };
}

export interface TemplateSummary {
  id: string;
  kind: TemplateKind;
  name: string;
  doc: TemplateDocument;
  builtIn: boolean;
}

/** The organisation's saved templates plus the built-in library (PHO-5), newest first. */
export async function listLibraryTemplates(organizationId: string, kind: TemplateKind): Promise<TemplateSummary[]> {
  const rows = await db()
    .select()
    .from(template)
    .where(
      and(
        eq(template.kind, kind),
        isNull(template.eventId),
        sql`(${template.organizationId} = ${organizationId} or ${template.organizationId} is null)`,
      ),
    )
    .orderBy(desc(template.updatedAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    doc: { canvas: r.canvas, elements: r.elements },
    builtIn: r.organizationId === null,
  }));
}

/** "Save as template": a copy in the organisation's library, reusable across events. */
export async function saveToLibrary(
  op: Operator,
  kind: TemplateKind,
  name: string,
  doc: TemplateDocument,
): Promise<string> {
  const id = uuidv7();
  await db().insert(template).values({
    id,
    organizationId: op.organizationId,
    eventId: null,
    kind,
    name,
    canvas: doc.canvas,
    elements: doc.elements,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

export async function deleteLibraryTemplate(organizationId: string, id: string): Promise<boolean> {
  const rows = await db()
    .delete(template)
    .where(and(eq(template.id, id), eq(template.organizationId, organizationId), isNull(template.eventId)))
    .returning({ id: template.id });
  return rows.length > 0;
}

/**
 * A library template adapted to an event's canvas (another print size or aspect): fitted with one
 * uniform scale so the design keeps its proportions.
 */
export function adaptToCanvas(doc: TemplateDocument, width: number, height: number): TemplateDocument {
  if (doc.canvas.width === width && doc.canvas.height === height) return doc;
  return fitDocument(doc, width, height);
}
