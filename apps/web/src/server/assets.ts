import 'server-only';
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type AnyColumn } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import {
  ASSET_QUOTA_BYTES,
  SNIFF_BYTES,
  assetUploadSchema,
  canonicalMime,
  normaliseMime,
  sniffMime,
  uuidv7,
  type AssetType,
} from '@immersia/shared';
import { fail, ok, type ActionResult } from './action-result';
import { allow } from './rate-limit';
import type { Operator } from './session';
import { assetObjectKey, deleteObjects, objectHead, objectSize, presignUpload, presignView } from './storage';

const { asset, event, template, display } = schema;

type AssetRow = typeof asset.$inferSelect;

/** An asset as the UI and the editor see it. `url` is a short-lived inline GET (see `presignView`). */
export interface AssetView {
  id: string;
  type: AssetType;
  name: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  createdAt: string;
  url: string;
}

/** Something that still uses an asset: an event, or an organization-library template (no event). */
export interface AssetUsage {
  id: string;
  name: string;
  kind: 'event' | 'template';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The library list is for people: bounded so a runaway account can't make the page unbounded. */
const LIST_LIMIT = 1000;

/** A started upload that never finished is cleaned up after this long (its URL lasts an hour). */
const PENDING_TTL_MS = 24 * 3_600_000;

async function toView(row: AssetRow, expiresIn: number): Promise<AssetView> {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    mime: row.mime,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    url: await presignView(row.objectKey, expiresIn),
  };
}

/** The organization's usable library, newest first. `types` narrows it; an empty list matches nothing. */
export async function listAssets(organizationId: string, types?: AssetType[]): Promise<AssetView[]> {
  if (types && types.length === 0) return [];
  const rows = await db()
    .select()
    .from(asset)
    .where(
      and(
        eq(asset.organizationId, organizationId),
        eq(asset.status, 'ready'),
        isNull(asset.deletedAt),
        types ? inArray(asset.type, types) : undefined,
      ),
    )
    .orderBy(desc(asset.createdAt), desc(asset.id))
    .limit(LIST_LIMIT);
  return Promise.all(rows.map((r) => toView(r, 3600)));
}

/**
 * Specific assets by id, in the order asked. Anything unknown, still uploading, deleted or owned by
 * another organization is silently left out, so a stale reference degrades instead of failing.
 */
export async function assetViews(organizationId: string, ids: string[], expiresIn = 3600): Promise<AssetView[]> {
  const wanted = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
  if (wanted.length === 0) return [];
  const rows = await db()
    .select()
    .from(asset)
    .where(
      and(
        eq(asset.organizationId, organizationId),
        eq(asset.status, 'ready'),
        isNull(asset.deletedAt),
        inArray(asset.id, wanted),
      ),
    );
  const views = new Map((await Promise.all(rows.map((r) => toView(r, expiresIn)))).map((v) => [v.id, v]));
  return wanted.flatMap((id) => views.get(id) ?? []);
}

export interface AssetUploadTicket {
  id: string;
  upload: { url: string; method: 'PUT'; headers: Record<string, string> };
}

/**
 * Step 1 of an upload: validate what the browser says it is sending, reserve the space and hand
 * back a presigned PUT whose content type and length are signed. The row stays `pending`, and
 * unusable, until `completeAssetUpload` has looked at the stored bytes.
 */
export async function createAssetUpload(op: Operator, input: unknown): Promise<ActionResult<AssetUploadTicket>> {
  const parsed = assetUploadSchema.safeParse(input);
  if (!parsed.success)
    return fail(
      'invalid',
      parsed.error.issues.map((i) => i.message),
    );
  if (!(await allow('assetUploadPerOrg', op.organizationId))) return fail('invalid', ['too_many']);
  const v = parsed.data;
  const id = uuidv7();
  const key = assetObjectKey(op.organizationId, id);
  const upload = await presignUpload(key, v.mime, v.bytes);
  const reserved = await db().transaction(async (tx) => {
    // Serialise this organization's reservations so two uploads can't both squeeze under the cap.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`asset-quota:${op.organizationId}`}))`);
    const [{ used } = { used: 0 }] = await tx
      .select({ used: sql<number>`coalesce(sum(${asset.bytes}), 0)`.mapWith(Number) })
      .from(asset)
      .where(and(eq(asset.organizationId, op.organizationId), isNull(asset.deletedAt)));
    if (used + v.bytes > ASSET_QUOTA_BYTES) return false;
    await tx.insert(asset).values({
      id,
      organizationId: op.organizationId,
      type: v.type,
      name: v.name,
      objectKey: key,
      mime: v.mime,
      bytes: v.bytes,
      width: v.width ?? null,
      height: v.height ?? null,
      durationMs: v.durationMs ?? null,
    });
    return true;
  });
  if (!reserved) return fail('invalid', ['quota']);
  return ok({ id, upload });
}

/**
 * Step 2: trust nothing the browser declared. The stored object must have exactly the declared
 * size and its first bytes must identify as the declared format; otherwise it is deleted and the
 * upload is refused. Retrying a completed upload is harmless.
 */
export async function completeAssetUpload(op: Operator, id: string): Promise<ActionResult<AssetView>> {
  if (!UUID_RE.test(id)) return fail('not_found');
  const [row] = await db()
    .select()
    .from(asset)
    .where(and(eq(asset.id, id), eq(asset.organizationId, op.organizationId), isNull(asset.deletedAt)))
    .limit(1);
  if (!row) return fail('not_found');
  if (row.status === 'ready') return ok(await toView(row, 3600));

  const size = await objectSize(row.objectKey);
  // Not (fully) there yet: leave the row so the browser can retry once its PUT has landed.
  if (size === null) return fail('failed');
  const head = size === row.bytes ? await objectHead(row.objectKey, SNIFF_BYTES) : null;
  if (!head || canonicalMime(row.type, sniffMime(head)) !== normaliseMime(row.mime)) {
    await deleteObjects([row.objectKey]);
    await db().delete(asset).where(eq(asset.id, row.id));
    return fail('invalid', ['wrong_type']);
  }
  const [ready] = await db()
    .update(asset)
    .set({ status: 'ready' })
    .where(and(eq(asset.id, row.id), isNull(asset.deletedAt)))
    .returning();
  return ready ? ok(await toView(ready, 3600)) : fail('not_found');
}

export async function renameAsset(op: Operator, id: string, name: string): Promise<ActionResult> {
  if (!UUID_RE.test(id)) return fail('not_found');
  const rows = await db()
    .update(asset)
    .set({ name })
    .where(
      and(
        eq(asset.id, id),
        eq(asset.organizationId, op.organizationId),
        eq(asset.status, 'ready'),
        isNull(asset.deletedAt),
      ),
    )
    .returning({ id: asset.id });
  return rows.length > 0 ? ok(undefined) : fail('not_found');
}

/**
 * Everything in the organization that mentions this asset. Settings and templates are JSON that
 * refer to assets by UUID, so a case-insensitive substring match on the JSON text is exact (a UUID
 * can't occur inside another value) and needs no schema knowledge of where an editor stores it.
 */
async function usages(organizationId: string, assetId: string): Promise<AssetUsage[]> {
  const pattern = `%${assetId}%`;
  const mentions = (...columns: AnyColumn[]) => or(...columns.map((c) => sql`${c}::text ilike ${pattern}`));
  const [events, displays, templates] = await Promise.all([
    db()
      .select({ id: event.id, name: event.name })
      .from(event)
      .where(and(eq(event.organizationId, organizationId), mentions(event.outputSettings, event.branding))),
    db()
      .select({ id: event.id, name: event.name })
      .from(display)
      .innerJoin(event, eq(event.id, display.eventId))
      .where(and(eq(event.organizationId, organizationId), mentions(display.settings))),
    db()
      .select({ id: template.id, name: template.name, eventId: event.id, eventName: event.name })
      .from(template)
      .leftJoin(event, eq(event.id, template.eventId))
      .where(
        and(
          or(eq(template.organizationId, organizationId), eq(event.organizationId, organizationId)),
          mentions(template.canvas, template.elements),
        ),
      ),
  ]);
  const found = new Map<string, AssetUsage>();
  for (const e of [...events, ...displays]) found.set(`event:${e.id}`, { id: e.id, name: e.name, kind: 'event' });
  for (const t of templates) {
    // An event's template counts as that event; an organization-library template stands for itself.
    if (t.eventId && t.eventName) found.set(`event:${t.eventId}`, { id: t.eventId, name: t.eventName, kind: 'event' });
    else found.set(`template:${t.id}`, { id: t.id, name: t.name, kind: 'template' });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Delete an asset unless something uses it: an event that references a deleted asset would render
 * a booth without its overlay or music, so we refuse and say what to detach first. The row is
 * soft-deleted (the cron removes it) and the object goes immediately.
 */
export async function deleteAsset(
  op: Operator,
  id: string,
): Promise<ActionResult<{ deleted: boolean; usedBy: AssetUsage[] }>> {
  if (!UUID_RE.test(id)) return fail('not_found');
  const [row] = await db()
    .select({ id: asset.id })
    .from(asset)
    .where(and(eq(asset.id, id), eq(asset.organizationId, op.organizationId), isNull(asset.deletedAt)))
    .limit(1);
  if (!row) return fail('not_found');
  const usedBy = await usages(op.organizationId, id);
  if (usedBy.length > 0) return ok({ deleted: false, usedBy });
  const [gone] = await db()
    .update(asset)
    .set({ deletedAt: new Date() })
    .where(and(eq(asset.id, id), eq(asset.organizationId, op.organizationId), isNull(asset.deletedAt)))
    .returning({ key: asset.objectKey });
  if (!gone) return fail('not_found');
  // If the object delete fails the soft-deleted row is still there for `purgeAssets` to retry.
  await deleteObjects([gone.key]).catch((err) => console.error('[assets] object delete failed', err));
  return ok({ deleted: true, usedBy: [] });
}

/**
 * The cron sweep: uploads that never completed, and soft-deleted rows. Objects are removed before
 * their rows, so a failure leaves the row for the next run instead of orphaning a file.
 */
export async function purgeAssets(limit = 1000): Promise<{ pending: number; deleted: number }> {
  const stale = new Date(Date.now() - PENDING_TTL_MS);
  const rows = await db()
    .select({ id: asset.id, key: asset.objectKey, deletedAt: asset.deletedAt })
    .from(asset)
    .where(or(isNotNull(asset.deletedAt), and(eq(asset.status, 'pending'), lt(asset.createdAt, stale))))
    .limit(limit);
  if (rows.length === 0) return { pending: 0, deleted: 0 };
  await deleteObjects(rows.map((r) => r.key));
  await db()
    .delete(asset)
    .where(
      inArray(
        asset.id,
        rows.map((r) => r.id),
      ),
    );
  const deleted = rows.filter((r) => r.deletedAt !== null).length;
  return { pending: rows.length - deleted, deleted };
}
