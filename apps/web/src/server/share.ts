import 'server-only';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { normalizeShortCode, shareSettingsSchema, type OutputKind, type RemovalBasis } from '@immersia/shared';
import { isServed, removalOf, stateOf, type SessionState } from './share-state';
import { EXT, slug } from './filenames';
import { deleteObjects, presignDownload, presignView } from './storage';

const { event, captureSession, output, organization } = schema;

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
  /** Why the session is not served, when its state is `hidden` (the operator) or `removed` (the platform). */
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
  /**
   * SHR-6: the optional guest form. `operator` is the business that runs the event and so the
   * controller of whatever the form collects; `extra` is its own consent sentence.
   */
  operator: string;
  guestForm: { enabled: boolean; requireName: boolean; extra: string; policyUrl: string };
  /** The event gallery, for the guest-form cookie that also covers it. */
  gallerySlug: string;
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
      erasedAt: captureSession.erasedAt,
      removedAt: captureSession.removedAt,
      removal: captureSession.removal,
      eventId: event.id,
      organizationId: event.organizationId,
      eventName: event.name,
      gallerySlug: event.gallerySlug,
      branding: event.branding,
      share: event.shareSettings,
      operator: organization.name,
    })
    .from(captureSession)
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .innerJoin(organization, eq(organization.id, event.organizationId))
    .where(eq(captureSession.linkId, linkId))
    .limit(1);
  if (!row) return null;
  // Older rows gain any settings added since they were written (the guest form's policy link).
  const settings = shareSettingsSchema.safeParse(row.share);
  const form = settings.success ? settings.data.guestForm : null;
  const base = {
    sessionId: row.sessionId,
    removal: null,
    event: { id: row.eventId, organizationId: row.organizationId, name: row.eventName, theme: row.branding.theme },
    shortCode: row.shortCode,
    expiresAt: row.expiresAt,
    contact: typeof row.share?.contact === 'string' ? row.share.contact : '',
    operator: row.operator,
    guestForm: {
      enabled: form?.enabled ?? false,
      requireName: form?.requireName ?? false,
      extra: form?.consentText ?? '',
      policyUrl: form?.policyUrl ?? '',
    },
    gallerySlug: row.gallerySlug,
  };
  // Taken down, erased, hidden or expired: nothing of it is served, whatever else is true of it
  // (the order is the one documented in share-state.ts).
  const gone = stateOf({ ...row, ready: 0 });
  if (!isServed(gone)) return { ...base, state: gone, removal: removalOf(row), files: [] };

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
  /** Hidden by the operator or taken down by the platform; `removal` says which (451 for `legal`). */
  | { error: 'removed'; removal: RemovalBasis }
  | { error: 'not_found' | 'expired' | 'erased' | 'not_ready' };

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
      erasedAt: captureSession.erasedAt,
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
  const state = stateOf({ ...row, ready: 1 });
  if (state === 'removed' || state === 'hidden') return { error: 'removed', removal: removalOf(row) ?? 'policy' };
  if (state === 'erased') return { error: 'erased' };
  if (state === 'expired') return { error: 'expired' };
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

/**
 * DL-2: a typed short code → the session's link id. `expired` is set only for a session whose
 * retention ran out (the code form says so); one that was erased, hidden or taken down still resolves,
 * so the guest lands on the link's own page, which says exactly what happened (410/451).
 */
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
      erasedAt: captureSession.erasedAt,
      removedAt: captureSession.removedAt,
      removal: captureSession.removal,
    })
    .from(captureSession)
    .where(eq(captureSession.shortCode, code))
    .limit(1);
  return row
    ? { linkId: row.linkId, eventId: row.eventId, expired: stateOf({ ...row, ready: 1 }) === 'expired' }
    : null;
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
  let swept = 0;
  for (const s of due) {
    // One stubborn session must not stop the others; it stays unmarked and is retried next hour.
    try {
      const keys = (
        await db().select({ key: output.objectKey }).from(output).where(eq(output.sessionId, s.id))
      ).flatMap((o) => (o.key ? [o.key] : []));
      if (keys.length) objects += await deleteObjects(keys);
      await db()
        .update(captureSession)
        .set({ expiredAt: new Date(), status: 'expired' })
        .where(eq(captureSession.id, s.id));
      swept++;
    } catch (err) {
      console.error('[expiry] could not sweep a session', s.id, err instanceof Error ? err.message : err);
    }
  }
  return { sessions: swept, objects };
}
