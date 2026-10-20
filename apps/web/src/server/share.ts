import 'server-only';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { normalizeShortCode, type OutputKind, type RemovalBasis } from '@immersia/shared';
import { isExpired, type SessionState } from './share-state';
import { EXT, slug } from './filenames';
import { deleteObjects, presignDownload, presignView } from './storage';

const { event, captureSession, output } = schema;

export interface ShareFile {
  id: string;
  kind: OutputKind;
  mime: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Inline URL for previews (short-lived, presigned). Null until the file is uploaded. */
  viewUrl: string | null;
}

export interface SharePage {
  state: SessionState;
  /** The guest session this page is for (analytics matches views to downloads by it). */
  sessionId: string;
  /** Why the session is not served, when its state is `removed`. */
  removal: RemovalBasis | null;
  event: {
    id: string;
    organizationId: string;
    name: string;
    theme: { accent: string; background: string; ink: string; font: 'sans' | 'serif' };
  };
  shortCode: string;
  expiresAt: Date;
  /** DL-12: the operator's contact, shown once the event has ended. */
  contact: string;
  files: ShareFile[];
}

/** What the share page shows (DL-1, DL-8): every output of the session, uploaded ones playable. */
export async function sharePage(linkId: string): Promise<SharePage | null> {
  const [row] = await db()
    .select({
      sessionId: captureSession.id,
      shortCode: captureSession.shortCode,
      expiresAt: captureSession.expiresAt,
      expiredAt: captureSession.expiredAt,
      removedAt: captureSession.removedAt,
      removal: captureSession.removal,
      eventId: event.id,
      organizationId: event.organizationId,
      eventName: event.name,
      branding: event.branding,
      share: event.shareSettings,
    })
    .from(captureSession)
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(eq(captureSession.linkId, linkId))
    .limit(1);
  if (!row) return null;
  const base = {
    sessionId: row.sessionId,
    removal: null,
    event: { id: row.eventId, organizationId: row.organizationId, name: row.eventName, theme: row.branding.theme },
    shortCode: row.shortCode,
    expiresAt: row.expiresAt,
    contact: typeof row.share?.contact === 'string' ? row.share.contact : '',
  };
  // Taken down or hidden: nothing of it is served, whatever its expiry says.
  if (row.removedAt) return { ...base, state: 'removed', removal: row.removal ?? 'policy', files: [] };
  if (isExpired(row)) return { ...base, state: 'expired', files: [] };

  const rows = await db().select().from(output).where(eq(output.sessionId, row.sessionId));
  const files = await Promise.all(
    rows.map(async (o): Promise<ShareFile> => ({
      id: o.id,
      kind: o.kind,
      mime: o.mime,
      bytes: o.bytes,
      width: o.width,
      height: o.height,
      durationMs: o.durationMs,
      viewUrl: o.uploadedAt && o.objectKey ? await presignView(o.objectKey) : null,
    })),
  );
  files.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return { ...base, state: files.some((f) => f.viewUrl) ? 'live' : 'pending', files };
}

/** Display and download order on the page: the main video first. */
const KIND_ORDER: OutputKind[] = ['mp4', 'strip', 'gif', 'boomerang', 'short_video', 'small_mp4', 'poster'];

export type DownloadResult =
  | { url: string; kind: OutputKind; bytes: number | null; eventId: string; sessionId: string }
  | { error: 'removed'; removal: RemovalBasis }
  | { error: 'not_found' | 'expired' | 'not_ready' };

/**
 * A download (DL-8): only through the session's own link id (the access secret), only while the
 * session is live. Counts the download and returns a short-lived URL that saves under the event's
 * filename prefix (EVT-5).
 */
export async function downloadUrl(linkId: string, outputId: string): Promise<DownloadResult> {
  const [row] = await db()
    .select({
      key: output.objectKey,
      kind: output.kind,
      mime: output.mime,
      bytes: output.bytes,
      uploadedAt: output.uploadedAt,
      eventId: event.id,
      sessionId: captureSession.id,
      expiresAt: captureSession.expiresAt,
      expiredAt: captureSession.expiredAt,
      removedAt: captureSession.removedAt,
      removal: captureSession.removal,
      prefix: captureSession.filenamePrefix,
      eventName: event.name,
    })
    .from(output)
    .innerJoin(captureSession, eq(captureSession.id, output.sessionId))
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(and(eq(output.id, outputId), eq(captureSession.linkId, linkId)))
    .limit(1);
  if (!row) return { error: 'not_found' };
  if (row.removedAt) return { error: 'removed', removal: row.removal ?? 'policy' };
  if (isExpired(row)) return { error: 'expired' };
  if (!row.uploadedAt || !row.key) return { error: 'not_ready' };
  await db()
    .update(output)
    .set({ downloads: sql`${output.downloads} + 1` })
    .where(eq(output.id, outputId));
  const filename = `${row.prefix}${slug(row.eventName)}-${row.kind.replace('_', '-')}.${EXT[row.mime] ?? 'bin'}`;
  return {
    url: await presignDownload(row.key, filename),
    kind: row.kind,
    bytes: row.bytes,
    eventId: row.eventId,
    sessionId: row.sessionId,
  };
}

/** DL-2: a typed short code → the session's link id. */
export async function linkIdForCode(
  input: string,
): Promise<{ linkId: string; eventId: string; expired: boolean } | null> {
  const code = normalizeShortCode(input);
  if (!code) return null;
  const [row] = await db()
    .select({
      linkId: captureSession.linkId,
      eventId: captureSession.eventId,
      expiresAt: captureSession.expiresAt,
      expiredAt: captureSession.expiredAt,
    })
    .from(captureSession)
    .where(eq(captureSession.shortCode, code))
    .limit(1);
  return row ? { linkId: row.linkId, eventId: row.eventId, expired: isExpired(row) } : null;
}

/**
 * The expiry sweep (DL-9): deletes the files of sessions past their expiry and marks them expired.
 * Bounded per run (the cron runs hourly); objects go first, so a failure leaves the session for the
 * next run rather than orphaning files.
 */
export async function expireSessions(limit = 200): Promise<{ sessions: number; objects: number }> {
  const due = await db()
    .select({ id: captureSession.id })
    .from(captureSession)
    .where(and(isNull(captureSession.expiredAt), lte(captureSession.expiresAt, new Date())))
    .limit(limit);
  if (!due.length) return { sessions: 0, objects: 0 };
  let objects = 0;
  for (const s of due) {
    const keys = (await db().select({ key: output.objectKey }).from(output).where(eq(output.sessionId, s.id))).flatMap(
      (o) => (o.key ? [o.key] : []),
    );
    if (keys.length) objects += await deleteObjects(keys);
    await db()
      .update(captureSession)
      .set({ expiredAt: new Date(), status: 'expired' })
      .where(eq(captureSession.id, s.id));
  }
  return { sessions: due.length, objects };
}
