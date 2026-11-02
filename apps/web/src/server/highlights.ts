import 'server-only';
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import {
  SNIFF_BYTES,
  brandingSchema,
  galleryUrl,
  outputSettingsSchema,
  shareSettingsSchema,
  sniffMime,
  uuidv7,
} from '@immersia/shared';
import { fail, ok, type ActionResult } from './action-result';
import { appOrigin } from './env';
import { getEvent } from './events';
import { slug } from './filenames';
import { publicSessions } from './gallery-filter';
import { footageGoneSql } from './highlight-footage';
import {
  boothCardSeconds,
  candidatesFor,
  highlightPlanSchema,
  highlightUploadSchema,
  pickReelMedia,
  selectHighlights,
  type GalleryHighlight,
  type HighlightCandidate,
  type HighlightItem,
  type HighlightPlan,
  type HighlightSummary,
  type ReelOutputRow,
} from './highlights-core';
import { allow } from './rate-limit';
import type { Operator } from './session';
import {
  deleteObjects,
  objectHead,
  objectKey,
  objectSize,
  presignDownload,
  presignUpload,
  presignView,
} from './storage';

const { captureSession, output, asset, eventHighlight } = schema;

/**
 * The highlight reel (LIV-14): picking what goes in it, publishing the montage the operator's browser built, and
 * showing it at the top of the client gallery. The picking only ever looks at what the public gallery shows, so a
 * hidden item, a guest who asked to stay off screen, an erased or an expired session can never end up in a reel.
 */

/** Plenty to choose from: an event is a few thousand captures at most, and each row is a handful of numbers. */
const CANDIDATE_LIMIT = 5000;
const MEDIA_KINDS = ['mp4', 'small_mp4', 'strip', 'boomerang', 'short_video'];
/** Long enough to download two dozen clips on a slow connection. */
const SOURCE_LINK_TTL_S = 2 * 3600;
/** An upload that never finished is cleaned up after this long (its link lasts an hour). */
const PENDING_TTL_MS = 3_600_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type HighlightRow = typeof eventHighlight.$inferSelect;
type SessionOutput = ReelOutputRow & { sessionId: string };

/** Every public session with something to put in a reel, with what it has earned. */
async function candidates(eventId: string): Promise<HighlightCandidate[]> {
  const kinds = sql.join(
    MEDIA_KINDS.map((k) => sql`${k}`),
    sql`, `,
  );
  const rows = await db()
    .select({
      id: captureSession.id,
      capturedAt: captureSession.capturedAt,
      views: captureSession.viewCount,
      displayScans: captureSession.displayScans,
      downloads:
        sql<number>`coalesce((select sum(o.downloads) from ${output} o where o.session_id = ${captureSession.id}), 0)`.mapWith(
          Number,
        ),
      photo: sql<boolean>`exists (select 1 from ${output} o where o.session_id = ${captureSession.id} and o.kind in ('strip', 'gif'))`,
    })
    .from(captureSession)
    .where(
      and(
        publicSessions(eventId),
        sql`exists (select 1 from ${output} o where o.session_id = ${captureSession.id} and o.uploaded_at is not null and o.kind in (${kinds}))`,
      ),
    )
    .orderBy(desc(captureSession.capturedAt), desc(captureSession.id))
    .limit(CANDIDATE_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    capturedAt: r.capturedAt.getTime(),
    booth: r.photo ? 'photo' : 'video360',
    downloads: r.downloads,
    displayScans: r.displayScans,
    views: r.views,
  }));
}

/** How many of these sessions are still in the public gallery. */
async function publicAmong(eventId: string, sessionIds: string[]): Promise<number> {
  const ids = [...new Set(sessionIds)].filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return 0;
  const [row] = await db()
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(captureSession)
    .where(and(publicSessions(eventId), inArray(captureSession.id, ids)));
  return row?.n ?? 0;
}

const uniqueCount = (ids: string[]) => new Set(ids).size;

async function readyAsset(organizationId: string, id: string | null | undefined) {
  if (!id) return null;
  const [row] = await db()
    .select({ key: asset.objectKey, mime: asset.mime, durationMs: asset.durationMs })
    .from(asset)
    .where(
      and(
        eq(asset.id, id),
        eq(asset.organizationId, organizationId),
        eq(asset.status, 'ready'),
        isNull(asset.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function summaryOf(row: HighlightRow): Promise<HighlightSummary> {
  const ids = row.sessionIds;
  const present = await publicAmong(row.eventId, ids);
  return {
    id: row.id,
    uploadedAt: (row.uploadedAt ?? row.createdAt).toISOString(),
    durationS: row.durationMs / 1000,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    clips: uniqueCount(ids),
    withheld: uniqueCount(ids) - present,
    url: await presignView(row.objectKey, 3600),
  };
}

/** The live reel of an event (the one on the gallery), for the studio card. */
export async function highlightSummary(organizationId: string, eventId: string): Promise<HighlightSummary | null> {
  if (!UUID_RE.test(eventId)) return null;
  const [row] = await db()
    .select({ h: eventHighlight })
    .from(eventHighlight)
    .innerJoin(schema.event, eq(schema.event.id, eventHighlight.eventId))
    .where(
      and(
        eq(eventHighlight.eventId, eventId),
        eq(schema.event.organizationId, organizationId),
        isNotNull(eventHighlight.uploadedAt),
      ),
    )
    .limit(1);
  return row ? summaryOf(row.h) : null;
}

/**
 * What the browser needs to build a reel: the gallery's best items for the length asked, with signed links, how
 * much of each booth video is the booth's own cards, and the event's theme, music and gallery link.
 */
export async function highlightPlan(
  organizationId: string,
  eventId: string,
  input: unknown,
): Promise<ActionResult<HighlightPlan>> {
  const parsed = highlightPlanSchema.safeParse(input);
  if (!parsed.success) return fail('invalid');
  const ev = await getEvent(organizationId, eventId);
  if (!ev) return fail('not_found');
  const { lengthS, quality } = parsed.data;

  const settings = outputSettingsSchema.parse(ev.outputSettings);
  const share = shareSettingsSchema.parse(ev.shareSettings);
  const branding = brandingSchema.parse(ev.branding);
  const pool = await candidates(ev.id);
  const ranked = selectHighlights(pool, candidatesFor(lengthS));
  const outputs: SessionOutput[] = ranked.length
    ? await db()
        .select({
          sessionId: output.sessionId,
          id: output.id,
          kind: output.kind,
          key: output.objectKey,
          width: output.width,
          height: output.height,
          durationMs: output.durationMs,
          bytes: output.bytes,
        })
        .from(output)
        .where(
          and(
            inArray(
              output.sessionId,
              ranked.map((r) => r.id),
            ),
            isNotNull(output.uploadedAt),
          ),
        )
    : [];

  const video = settings.video360;
  const [intro, outro, music] = await Promise.all([
    readyAsset(organizationId, video.introAssetId),
    readyAsset(organizationId, video.outroAssetId),
    readyAsset(organizationId, video.music?.assetId),
  ]);
  const margins = boothCardSeconds(
    video,
    new Map([
      ...(video.introAssetId && intro ? [[video.introAssetId, intro] as const] : []),
      ...(video.outroAssetId && outro ? [[video.outroAssetId, outro] as const] : []),
    ]),
    share.endFrameQr,
  );

  const byId = new Map(pool.map((c) => [c.id, c]));
  const built = await Promise.all(
    ranked.map(async (r): Promise<HighlightItem | null> => {
      const media = pickReelMedia(
        outputs.filter((o) => o.sessionId === r.id),
        quality,
      );
      if (!media) return null;
      const c = byId.get(r.id)!;
      // Photo-booth videos are made straight from the camera frames: no cards to trim off.
      const cards = media.kind === 'video' && media.booth === 'video360';
      return {
        sessionId: r.id,
        kind: media.kind,
        url: await presignView(media.output.key!, SOURCE_LINK_TTL_S),
        bytes: media.output.bytes,
        durationS: media.output.durationMs ? media.output.durationMs / 1000 : null,
        headS: cards ? margins.headS : 0,
        tailS: cards ? margins.tailS : 0,
        weight: r.weight,
        capturedAt: c.capturedAt,
        booth: media.booth,
      };
    }),
  );

  return ok({
    event: {
      name: ev.name,
      date: ev.date,
      theme: branding.theme,
      galleryUrl: galleryUrl(appOrigin(), ev.gallerySlug, 'event_qr'),
      aspect: video.aspect,
    },
    items: built.filter((i): i is HighlightItem => i !== null),
    available: pool.length,
    music:
      music && video.music
        ? {
            url: await presignView(music.key, SOURCE_LINK_TTL_S),
            settings: {
              trimStartMs: video.music.trimStartMs,
              trimEndMs: video.music.trimEndMs,
              volume: video.music.volume,
            },
          }
        : null,
  });
}

// -----------------------------------------------------------------------------------------------
// Publishing

export interface HighlightUploadTicket {
  id: string;
  video: { url: string; method: 'PUT'; headers: Record<string, string> };
  poster: { url: string; method: 'PUT'; headers: Record<string, string> } | null;
}

/** Take down a reel's files, then its rows. If the store refuses a file the rows stay, so it is tried again. */
async function removeRows(rows: Pick<HighlightRow, 'id' | 'objectKey' | 'posterKey'>[]): Promise<void> {
  if (rows.length === 0) return;
  await deleteObjects(rows.flatMap((r) => (r.posterKey ? [r.objectKey, r.posterKey] : [r.objectKey])));
  await db()
    .delete(eventHighlight)
    .where(
      inArray(
        eventHighlight.id,
        rows.map((r) => r.id),
      ),
    );
}

/**
 * Step 1 of publishing: check what the browser says it built, make sure every clip in it is still in the public
 * gallery, and hand back presigned uploads. The reel is not shown to anyone until `completeHighlightUpload`.
 */
export async function createHighlightUpload(
  op: Operator,
  eventId: string,
  input: unknown,
): Promise<ActionResult<HighlightUploadTicket>> {
  const parsed = highlightUploadSchema.safeParse(input);
  if (!parsed.success)
    return fail(
      'invalid',
      parsed.error.issues.map((i) => i.message),
    );
  const ev = await getEvent(op.organizationId, eventId);
  if (!ev) return fail('not_found');
  if (!(await allow('highlightPerOrg', op.organizationId))) return fail('rate_limited');
  const v = parsed.data;
  // A clip hidden (or erased) since the reel was planned must not be published.
  if ((await publicAmong(ev.id, v.sessionIds)) !== uniqueCount(v.sessionIds)) return fail('conflict', ['withheld']);

  // Uploads that never finished go now, with their files.
  const abandoned = await db()
    .select()
    .from(eventHighlight)
    .where(
      and(
        eq(eventHighlight.eventId, ev.id),
        isNull(eventHighlight.uploadedAt),
        lt(eventHighlight.createdAt, new Date(Date.now() - PENDING_TTL_MS)),
      ),
    );
  await removeRows(abandoned).catch((err: unknown) =>
    console.error('[highlight] could not clear abandoned uploads', err instanceof Error ? err.message : err),
  );

  const id = uuidv7();
  const key = objectKey(op.organizationId, ev.id, id, 'mp4');
  const posterKey = v.posterBytes ? objectKey(op.organizationId, ev.id, `${id}-poster`, 'jpg') : null;
  const [video, poster] = await Promise.all([
    presignUpload(key, 'video/mp4', v.bytes),
    posterKey && v.posterBytes ? presignUpload(posterKey, 'image/jpeg', v.posterBytes) : null,
  ]);
  await db()
    .insert(eventHighlight)
    .values({
      id,
      eventId: ev.id,
      objectKey: key,
      posterKey,
      bytes: v.bytes,
      width: v.width,
      height: v.height,
      durationMs: v.durationMs,
      sessionIds: [...new Set(v.sessionIds)],
      createdBy: op.userId,
    });
  return ok({ id, video, poster });
}

/**
 * Step 2: trust nothing the browser declared. The stored file must have exactly the declared size and start like an
 * MP4; the clips must all still be public; then it replaces the event's previous reel in one step.
 */
export async function completeHighlightUpload(
  op: Operator,
  eventId: string,
  id: string,
): Promise<ActionResult<HighlightSummary>> {
  if (!UUID_RE.test(id)) return fail('not_found');
  const [found] = await db()
    .select({ h: eventHighlight })
    .from(eventHighlight)
    .innerJoin(schema.event, eq(schema.event.id, eventHighlight.eventId))
    .where(
      and(
        eq(eventHighlight.id, id),
        eq(eventHighlight.eventId, eventId),
        eq(schema.event.organizationId, op.organizationId),
      ),
    )
    .limit(1);
  if (!found) return fail('not_found');
  const row = found.h;
  if (row.uploadedAt) return ok(await summaryOf(row));

  const size = await objectSize(row.objectKey);
  // Not (fully) there yet: leave the row so the browser can retry once its PUT has landed.
  if (size === null) return fail('failed');
  const head = size === row.bytes ? await objectHead(row.objectKey, SNIFF_BYTES) : null;
  if (!head || sniffMime(head) !== 'video/mp4') {
    await removeRows([row]).catch(() => undefined);
    return fail('invalid', ['wrong_type']);
  }
  if ((await publicAmong(row.eventId, row.sessionIds)) !== uniqueCount(row.sessionIds)) {
    await removeRows([row]).catch(() => undefined);
    return fail('conflict', ['withheld']);
  }
  // A poster is a nicety: one that did not arrive intact is dropped, the reel is kept.
  let posterKey = row.posterKey;
  if (posterKey) {
    const stillThere = (await objectSize(posterKey)) !== null;
    const poster = stillThere ? await objectHead(posterKey, SNIFF_BYTES) : null;
    if (!poster || sniffMime(poster) !== 'image/jpeg') {
      await deleteObjects([posterKey]).catch(() => undefined);
      posterKey = null;
    }
  }

  const replaced = await db().transaction(async (tx) => {
    // The reel it replaces stops being the live one at once, but keeps its row until its files are gone: a file the
    // store refuses to delete is then found again by the sweep, never left behind with nothing pointing at it.
    const previous = await tx
      .update(eventHighlight)
      .set({ uploadedAt: null })
      .where(and(eq(eventHighlight.eventId, row.eventId), isNotNull(eventHighlight.uploadedAt)))
      .returning();
    await tx.update(eventHighlight).set({ uploadedAt: new Date(), posterKey }).where(eq(eventHighlight.id, row.id));
    return previous;
  });
  await removeRows(replaced).catch((err: unknown) =>
    console.error('[highlight] could not delete the replaced reel', err instanceof Error ? err.message : err),
  );
  return ok(await summaryOf({ ...row, posterKey, uploadedAt: new Date() }));
}

/** The operator takes the reel off the client gallery. */
export async function removeHighlight(op: Operator, eventId: string): Promise<ActionResult> {
  const ev = await getEvent(op.organizationId, eventId);
  if (!ev) return fail('not_found');
  const rows = await db().select().from(eventHighlight).where(eq(eventHighlight.eventId, ev.id));
  await removeRows(rows);
  return ok(undefined);
}

// -----------------------------------------------------------------------------------------------
// The client gallery

/**
 * The reel for the top of the event gallery, or null. A reel holds guests' footage, so it is shown only while every
 * clip in it is still public: hiding an item, or a guest opting out, takes the reel down until it is rebuilt.
 */
export async function galleryHighlight(eventId: string, eventName: string): Promise<GalleryHighlight | null> {
  const [row] = await db()
    .select()
    .from(eventHighlight)
    .where(and(eq(eventHighlight.eventId, eventId), isNotNull(eventHighlight.uploadedAt)))
    .limit(1);
  if (!row) return null;
  if ((await publicAmong(eventId, row.sessionIds)) !== uniqueCount(row.sessionIds)) return null;
  const [url, downloadUrl, poster] = await Promise.all([
    presignView(row.objectKey, 3600),
    presignDownload(row.objectKey, `${slug(eventName)}-highlights.mp4`, 3600),
    row.posterKey ? presignView(row.posterKey, 3600) : null,
  ]);
  return { url, downloadUrl, poster, width: row.width, height: row.height, durationS: row.durationMs / 1000 };
}

// -----------------------------------------------------------------------------------------------
// Privacy and expiry

/**
 * A guest erased their session: every reel with their footage in it goes, files first (a file the store refuses to
 * delete keeps its row, and the sweep tries again). Called from the erasure itself.
 */
export async function withdrawHighlightsWith(sessionId: string): Promise<number> {
  const rows = await db()
    .select()
    .from(eventHighlight)
    .where(sql`${eventHighlight.sessionIds} @> ${JSON.stringify([sessionId])}::jsonb`);
  await removeRows(rows);
  return rows.length;
}

/**
 * The hourly sweep: a reel whose clips include a session that was erased, has expired (by the flag or by the clock),
 * whose guest asked to stay off screens or that the platform took down is deleted (the footage it holds is meant to
 * be gone: see highlight-footage.ts), and so is an upload that was started and never finished. A clip the operator
 * merely hid only keeps the reel off the gallery until they show it again.
 */
export async function sweepHighlights(limit = 50): Promise<{ reels: number }> {
  const gone = await db()
    .select()
    .from(eventHighlight)
    .where(
      sql`exists (
        select 1 from jsonb_array_elements_text(${eventHighlight.sessionIds}) as sid
        join ${captureSession} s on s.id = sid::uuid
        where ${footageGoneSql}
      )`,
    )
    .limit(limit);
  const abandoned = await db()
    .select()
    .from(eventHighlight)
    .where(and(isNull(eventHighlight.uploadedAt), lt(eventHighlight.createdAt, new Date(Date.now() - PENDING_TTL_MS))))
    .limit(limit);
  const rows = [...new Map([...gone, ...abandoned].map((r) => [r.id, r])).values()];
  await removeRows(rows);
  return { reels: rows.length };
}
