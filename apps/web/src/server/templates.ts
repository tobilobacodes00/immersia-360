import 'server-only';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import {
  aspectOfCanvas,
  brandingSchema,
  canvasSizeFor,
  eventBooths,
  outputSettingsSchema,
  type ASPECTS,
  type OutputSettings,
  type PRINT_SIZES,
  overlayCanvasFor,
  templateDocumentSchema,
  uuidv7,
  type TemplateDocument,
} from '@immersia/shared';
import {
  builtinTemplate,
  fitDocument,
  isBuiltinId,
  overlayPreset,
  presetTemplate,
  shotsIn,
  type Shots,
  type StyleId,
  type TemplateCategory,
} from '@immersia/layout';
import { BUILTIN_VERSION, builtinName, builtinSummaries } from '@/lib/builtin-templates';
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

/**
 * A template the organisation may read: its own, a legacy shared row (organization_id null), or one of
 * the generated built-ins (`lib:…` ids, which never touch the database).
 */
export async function getTemplate(organizationId: string, id: string): Promise<TemplateRecord | null> {
  if (isBuiltinId(id)) {
    const b = builtinTemplate(id);
    return b
      ? { id: b.id, kind: b.kind, name: builtinName(b), eventId: null, doc: b.doc, version: BUILTIN_VERSION }
      : null;
  }
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
    // An event that dropped its overlay and wants one again gets its previous design back.
    const [previous] = await tx
      .select()
      .from(template)
      .where(and(eq(template.eventId, eventId), eq(template.kind, kind)))
      .orderBy(desc(template.updatedAt))
      .limit(1);
    if (previous) {
      await tx
        .update(event)
        .set({ outputSettings: pointAt(output, kind, previous.id) })
        .where(eq(event.id, eventId));
      return toRecord(previous);
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
    await tx
      .update(event)
      .set({ outputSettings: pointAt(output, kind, id) })
      .where(eq(event.id, eventId));
    return toRecord(row!);
  });
}

function pointAt(output: OutputSettings, kind: TemplateKind, id: string): OutputSettings {
  return kind === 'layout'
    ? { ...output, photo: { ...output.photo, layoutTemplateId: id } }
    : { ...output, video360: { ...output.video360, overlayTemplateId: id } };
}

/**
 * The operator picked another design (a preset, a library template, an uploaded overlay PNG) for
 * the event: it replaces the event's working copy outright, fitted to the event's canvas.
 */
export async function applyEventDesign(
  op: Operator,
  eventId: string,
  kind: TemplateKind,
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; reason: 'not_found' | 'invalid' }> {
  const parsed = templateDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const record = await ensureEventTemplate(op, eventId, kind);
  if (!record) return { ok: false, reason: 'not_found' };
  const [ev] = await db()
    .select({ outputSettings: event.outputSettings })
    .from(event)
    .where(eq(event.id, eventId))
    .limit(1);
  const target = targetCanvas(kind, outputSettingsSchema.parse(ev!.outputSettings));
  const fitted = adaptToCanvas(parsed.data, target.width, target.height);
  // A layout fitted to the event's page is a layout for the event's print size.
  const doc =
    kind === 'layout'
      ? {
          ...fitted,
          canvas: { ...fitted.canvas, printSize: outputSettingsSchema.parse(ev!.outputSettings).photo.printSize },
        }
      : fitted;
  await db()
    .update(template)
    .set({ canvas: doc.canvas, elements: doc.elements, updatedAt: new Date() })
    .where(and(eq(template.id, record.id), eq(template.organizationId, op.organizationId)));
  return { ok: true, id: record.id };
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
  // Built-in templates are read-only: a save names a database row.
  if (isBuiltinId(id)) return { ok: false, reason: 'invalid' };
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
  /** Built-ins only: the occasion and style, so the UI can filter and name them in the reader's language. */
  category?: TemplateCategory;
  style?: StyleId;
  /** Layouts: the print size the page is made for. */
  printSize?: (typeof PRINT_SIZES)[number];
  /** Overlays: the video aspect the canvas is made for. */
  aspect?: (typeof ASPECTS)[number];
  /** Layouts: how many shots the design takes. */
  shots?: number;
}

/** What the library screen needs to know about a saved template without reading its name. */
function sizeOf(kind: TemplateKind, doc: TemplateDocument): Pick<TemplateSummary, 'printSize' | 'aspect' | 'shots'> {
  if (kind === 'layout')
    return { ...(doc.canvas.printSize ? { printSize: doc.canvas.printSize } : {}), shots: shotsIn(doc) };
  const aspect = aspectOfCanvas(doc.canvas);
  return aspect ? { aspect } : {};
}

/**
 * The organisation's own saved templates, newest first, then the built-in library (PHO-5). Pages that
 * only show the organisation's own pass `builtIns: false`: the library is also importable in the
 * browser (`builtinSummaries`), which spares every page a megabyte of identical documents.
 */
export async function listLibraryTemplates(
  organizationId: string,
  kind: TemplateKind,
  opts: { builtIns?: boolean } = {},
): Promise<TemplateSummary[]> {
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
  const own = rows.map((r): TemplateSummary => {
    const doc = { canvas: r.canvas, elements: r.elements };
    return { id: r.id, kind: r.kind, name: r.name, doc, builtIn: r.organizationId === null, ...sizeOf(r.kind, doc) };
  });
  return opts.builtIns === false ? own : [...own, ...builtinSummaries(kind)];
}

/** An event a design can be used for, with the page it prints on and the video it overlays. */
export interface DesignTarget {
  id: string;
  name: string;
  date: string;
  layout: { printSize: (typeof PRINT_SIZES)[number]; shots: number } | null;
  overlay: { aspect: (typeof ASPECTS)[number] } | null;
}

/** The organisation's live events and what each one designs: a print layout, a video overlay or both. */
export async function listDesignTargets(organizationId: string): Promise<DesignTarget[]> {
  const rows = await db()
    .select({
      id: event.id,
      name: event.name,
      date: event.date,
      mode: event.mode,
      outputSettings: event.outputSettings,
    })
    .from(event)
    .where(and(eq(event.organizationId, organizationId), ne(event.status, 'archived')))
    .orderBy(desc(event.date), desc(event.updatedAt))
    .limit(200);
  return rows.map((r) => {
    const output = outputSettingsSchema.parse(r.outputSettings);
    const booths = eventBooths(r.mode, output);
    return {
      id: r.id,
      name: r.name,
      date: r.date,
      layout: booths.includes('photo') ? { printSize: output.photo.printSize, shots: output.photo.shots } : null,
      overlay: booths.includes('video360') ? { aspect: output.video360.aspect } : null,
    };
  });
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
  // Built-ins are read-only: there is no row to delete.
  if (isBuiltinId(id)) return false;
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
