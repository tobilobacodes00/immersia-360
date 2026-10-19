import 'server-only';
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, sql, sum } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import {
  brandingSchema,
  defaultBranding,
  defaultOutputSettings,
  defaultShareSettings,
  newLinkId,
  outputSettingsSchema,
  shareSettingsSchema,
  uuidv7,
  type BrandingSettings,
  type CreateEventInput,
  type OutputSettings,
  type ShareSettings,
} from '@immersia/shared';
import type { Operator } from './session';

const { event, captureSession, output, uploadObject, template, device } = schema;

export type EventRow = typeof event.$inferSelect;
export type BoothMode = EventRow['mode'];

export interface EventListFilters {
  q?: string;
  mode?: BoothMode;
  from?: string;
  to?: string;
  archived?: boolean;
}

export interface EventListItem {
  id: string;
  name: string;
  date: string;
  mode: BoothMode;
  status: EventRow['status'];
  sessions: number;
  storageBytes: number;
  updatedAt: Date;
}

/** Events list (screen 3): search, filter by mode and date, storage per event. */
export async function listEvents(
  organizationId: string,
  f: EventListFilters = {},
  limit = 200,
): Promise<EventListItem[]> {
  // Aggregate per event in a subquery so the list is one round trip, however many events there are.
  const usage = db()
    .select({
      eventId: captureSession.eventId,
      sessions: sql<number>`count(distinct ${captureSession.id})`.mapWith(Number).as('sessions'),
      storageBytes: sql<number>`coalesce(sum(${output.bytes}), 0)`.mapWith(Number).as('storage_bytes'),
    })
    .from(captureSession)
    .leftJoin(output, eq(output.sessionId, captureSession.id))
    .groupBy(captureSession.eventId)
    .as('usage');

  const where = and(
    eq(event.organizationId, organizationId),
    f.archived ? eq(event.status, 'archived') : ne(event.status, 'archived'),
    f.mode ? eq(event.mode, f.mode) : undefined,
    f.from ? gte(event.date, f.from) : undefined,
    f.to ? lte(event.date, f.to) : undefined,
    f.q ? ilike(event.name, `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
  );

  const rows = await db()
    .select({
      id: event.id,
      name: event.name,
      date: event.date,
      mode: event.mode,
      status: event.status,
      updatedAt: event.updatedAt,
      sessions: sql<number>`coalesce(${usage.sessions}, 0)`.mapWith(Number),
      storageBytes: sql<number>`coalesce(${usage.storageBytes}, 0)`.mapWith(Number),
    })
    .from(event)
    .leftJoin(usage, eq(usage.eventId, event.id))
    .where(where)
    .orderBy(desc(event.date), desc(event.updatedAt))
    .limit(limit);
  return rows;
}

export async function getEvent(organizationId: string, id: string): Promise<EventRow | null> {
  const [row] = await db()
    .select()
    .from(event)
    .where(and(eq(event.id, id), eq(event.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/** 96 random bits, URL-safe: the event gallery link (/g/[slug]) is unguessable. */
const newGallerySlug = () => newLinkId().slice(0, 16);

/** EVT-1. Defaults come from the shared schemas so device, API and DB agree. */
export async function createEvent(op: Operator, input: CreateEventInput): Promise<string> {
  const id = uuidv7();
  await db().insert(event).values({
    id,
    organizationId: op.organizationId,
    name: input.name,
    date: input.date,
    mode: input.mode,
    expiryDays: input.expiryDays,
    outputSettings: defaultOutputSettings(),
    shareSettings: defaultShareSettings(),
    branding: defaultBranding(),
    gallerySlug: newGallerySlug(),
    createdBy: op.userId,
  });
  return id;
}

/**
 * EVT-2: duplicate with all settings and assets. Org-level assets are shared by reference; templates
 * owned by the source event are copied, and every settings reference to them is re-pointed at the
 * copy, so editing the duplicate's overlay never changes the original's.
 */
export async function duplicateEvent(op: Operator, sourceId: string, name: string): Promise<string | null> {
  return db().transaction(async (tx) => {
    const [src] = await tx
      .select()
      .from(event)
      .where(and(eq(event.id, sourceId), eq(event.organizationId, op.organizationId)))
      .limit(1);
    if (!src) return null;
    const id = uuidv7();
    const templates = await tx.select().from(template).where(eq(template.eventId, src.id));
    const remap = new Map(templates.map((t) => [t.id, uuidv7()]));
    const re = (tid: string | null) => (tid ? (remap.get(tid) ?? tid) : null);
    const out = structuredClone(src.outputSettings);
    out.video360.overlayTemplateId = re(out.video360.overlayTemplateId);
    out.photo.layoutTemplateId = re(out.photo.layoutTemplateId);
    await tx.insert(event).values({
      ...src,
      id,
      name,
      status: 'draft',
      outputSettings: out,
      gallerySlug: newGallerySlug(),
      galleryPasswordHash: null,
      filenameSequence: 1,
      duplicatedFromId: src.id,
      createdBy: op.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    });
    if (templates.length) {
      await tx.insert(template).values(
        templates.map((t) => ({
          ...t,
          id: remap.get(t.id)!,
          eventId: id,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
    }
    return id;
  });
}

export async function setArchived(organizationId: string, id: string, archived: boolean): Promise<boolean> {
  const rows = await db()
    .update(event)
    .set(archived ? { status: 'archived', archivedAt: new Date() } : { status: 'draft', archivedAt: null })
    .where(and(eq(event.id, id), eq(event.organizationId, organizationId)))
    .returning({ id: event.id });
  return rows.length > 0;
}

export interface EventBasicsPatch {
  name?: string;
  date?: string;
  mode?: BoothMode;
  expiryDays?: 7 | 30 | 90;
  filenamePrefixEnabled?: boolean;
  liveDisplayEnabled?: boolean;
  moderation?: 'auto' | 'approve';
}

export async function updateBasics(organizationId: string, id: string, patch: EventBasicsPatch): Promise<boolean> {
  if (Object.keys(patch).length === 0) return true;
  const rows = await db()
    .update(event)
    .set(patch)
    .where(and(eq(event.id, id), eq(event.organizationId, organizationId)))
    .returning({ id: event.id });
  return rows.length > 0;
}

type JsonSection = 'outputSettings' | 'shareSettings' | 'branding';
const SECTION_SCHEMA = {
  outputSettings: outputSettingsSchema,
  shareSettings: shareSettingsSchema,
  branding: brandingSchema,
} as const;

/**
 * Replace one JSON settings section after full validation (never a partial merge on the client's
 * word: the stored document is always a complete, valid object).
 */
export async function updateSection<S extends JsonSection>(
  organizationId: string,
  id: string,
  section: S,
  value: unknown,
): Promise<{ ok: true } | { ok: false; issues: string[] }> {
  const parsed = SECTION_SCHEMA[section].safeParse(value);
  if (!parsed.success)
    return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const set = { [section]: parsed.data } as Partial<{
    outputSettings: OutputSettings;
    shareSettings: ShareSettings;
    branding: BrandingSettings;
  }>;
  const rows = await db()
    .update(event)
    .set(set)
    .where(and(eq(event.id, id), eq(event.organizationId, organizationId)))
    .returning({ id: event.id });
  return rows.length ? { ok: true } : { ok: false, issues: ['event not found'] };
}

export interface EventStats {
  sessions: number;
  videos: number;
  photos: number;
  gifs: number;
  storageBytes: number;
  uploadsPending: number;
  renderQueue: number;
  activeDevices: number;
}

/** EVT-3 dashboard: counts, storage, upload backlog and the render queue reported by booths. */
export async function eventStats(organizationId: string, id: string): Promise<EventStats> {
  const scoped = and(eq(captureSession.eventId, id), eq(event.organizationId, organizationId));
  const [[sessions], kinds, [pending], devices] = await Promise.all([
    db()
      .select({ n: count() })
      .from(captureSession)
      .innerJoin(event, eq(event.id, captureSession.eventId))
      .where(scoped),
    db()
      .select({ kind: output.kind, n: count(), bytes: sum(output.bytes).mapWith(Number) })
      .from(output)
      .innerJoin(captureSession, eq(captureSession.id, output.sessionId))
      .innerJoin(event, eq(event.id, captureSession.eventId))
      .where(scoped)
      .groupBy(output.kind),
    db()
      .select({ n: count() })
      .from(uploadObject)
      .innerJoin(output, eq(output.id, uploadObject.outputId))
      .innerJoin(captureSession, eq(captureSession.id, output.sessionId))
      .innerJoin(event, eq(event.id, captureSession.eventId))
      .where(and(scoped, ne(uploadObject.status, 'done'))),
    db()
      .select({ status: device.status })
      .from(device)
      .where(
        and(
          eq(device.organizationId, organizationId),
          isNull(device.revokedAt),
          isNotNull(device.status),
          sql`${device.status}->>'eventId' = ${id}`,
          gte(device.lastSeenAt, new Date(Date.now() - 5 * 60_000)),
        ),
      ),
  ]);
  const byKind = new Map(kinds.map((k) => [k.kind, k]));
  const n = (k: (typeof schema.outputKind.enumValues)[number]) => byKind.get(k)?.n ?? 0;
  return {
    sessions: sessions?.n ?? 0,
    videos: n('mp4'),
    photos: n('strip'),
    gifs: n('gif') + n('boomerang'),
    storageBytes: kinds.reduce((a, k) => a + (k.bytes ?? 0), 0),
    uploadsPending: (pending?.n ?? 0) + devices.reduce((a, d) => a + (d.status?.uploadQueue ?? 0), 0),
    renderQueue: devices.reduce((a, d) => a + (d.status?.renderQueue ?? 0), 0),
    activeDevices: devices.length,
  };
}

/** Recent events for the mode launcher (screen 2). */
export async function recentEvents(organizationId: string, limit = 6) {
  return db()
    .select({ id: event.id, name: event.name, date: event.date, mode: event.mode, status: event.status })
    .from(event)
    .where(and(eq(event.organizationId, organizationId), inArray(event.status, ['draft', 'live'])))
    .orderBy(desc(event.updatedAt))
    .limit(limit);
}

export interface GuestFilesSummary {
  /** Sessions whose links still work. */
  live: number;
  /** When the next of them expires (null when none are live). */
  nextExpiry: Date | null;
  /** Sessions already swept: their files are gone. */
  removed: number;
}

/** DL-12 / SHR-8: how long the event's guest links last. */
export async function guestFilesSummary(organizationId: string, eventId: string): Promise<GuestFilesSummary> {
  const [row] = await db()
    .select({
      live: sql<number>`count(*) filter (where ${captureSession.expiredAt} is null)`.mapWith(Number),
      removed: sql<number>`count(*) filter (where ${captureSession.expiredAt} is not null)`.mapWith(Number),
      nextExpiry:
        sql<Date | null>`min(${captureSession.expiresAt}) filter (where ${captureSession.expiredAt} is null)`.mapWith(
          (v: string | Date | null) => (v ? new Date(v) : null),
        ),
    })
    .from(captureSession)
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(and(eq(captureSession.eventId, eventId), eq(event.organizationId, organizationId)));
  return { live: row?.live ?? 0, removed: row?.removed ?? 0, nextExpiry: row?.nextExpiry ?? null };
}

/**
 * DL-12: give every live guest link of the event more time (from now, or from its current expiry if
 * later). Files already swept can't be brought back. Returns how many links were extended, or null
 * when the event isn't the organization's.
 */
export async function extendGuestFiles(organizationId: string, eventId: string, days: number): Promise<number | null> {
  const [owned] = await db()
    .select({ id: event.id })
    .from(event)
    .where(and(eq(event.id, eventId), eq(event.organizationId, organizationId)))
    .limit(1);
  if (!owned) return null;
  const rows = await db()
    .update(captureSession)
    .set({ expiresAt: sql`greatest(${captureSession.expiresAt}, now()) + make_interval(days => ${days})` })
    .where(and(eq(captureSession.eventId, eventId), isNull(captureSession.expiredAt)))
    .returning({ id: captureSession.id });
  return rows.length;
}
