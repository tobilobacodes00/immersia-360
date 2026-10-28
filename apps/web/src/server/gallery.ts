import 'server-only';
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import {
  brandingSchema,
  eventBooths,
  outputSettingsSchema,
  shareSettingsSchema,
  type BoothMode,
  type GuestFormSettings,
} from '@immersia/shared';
import { env } from './env';
import { pickMedia, sessionBooth } from './live';
import { presignView } from './storage';

const { event, captureSession, output, asset } = schema;

/**
 * The event gallery (screen 19, SHR-5, DL-7): every capture of the event on one page, for the client
 * and for guests who scan the event QR. Hidden items (LIV-7) and guests who asked not to be shown
 * (LIV-8) are left out of this public page; the operator's export (EVT-4) has everything.
 */

export interface GalleryEvent {
  id: string;
  organizationId: string;
  name: string;
  date: string;
  slug: string;
  theme: { accent: string; background: string; ink: string; font: 'sans' | 'serif' };
  hashtag: string;
  logoUrl: string | null;
  booths: BoothMode[];
  contact: string;
  passwordHash: string | null;
  /** SHR-6: the business running the event, and the optional guest form shown before "Download all". */
  operator: string;
  guestForm: GuestFormSettings;
}

export async function galleryEvent(slug: string): Promise<GalleryEvent | null> {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(slug)) return null;
  const [found] = await db()
    .select({ ev: event, operator: schema.organization.name })
    .from(event)
    .innerJoin(schema.organization, eq(schema.organization.id, event.organizationId))
    .where(eq(event.gallerySlug, slug))
    .limit(1);
  if (!found) return null;
  const { ev, operator } = found;
  const share = shareSettingsSchema.parse(ev.shareSettings);
  const branding = brandingSchema.parse(ev.branding);
  let logoUrl: string | null = null;
  if (branding.logoAssetId) {
    const [logo] = await db()
      .select({ key: asset.objectKey })
      .from(asset)
      .where(
        and(
          eq(asset.id, branding.logoAssetId),
          eq(asset.organizationId, ev.organizationId),
          eq(asset.status, 'ready'),
          isNull(asset.deletedAt),
        ),
      )
      .limit(1);
    if (logo) logoUrl = await presignView(logo.key, 3600);
  }
  return {
    id: ev.id,
    organizationId: ev.organizationId,
    name: ev.name,
    date: ev.date,
    slug,
    theme: branding.theme,
    hashtag: branding.hashtag,
    logoUrl,
    booths: eventBooths(ev.mode, outputSettingsSchema.parse(ev.outputSettings)),
    contact: share.contact,
    passwordHash: ev.galleryPasswordHash,
    operator,
    guestForm: share.guestForm,
  };
}

// -----------------------------------------------------------------------------------------------
// The optional password (SHR-5)

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashGalleryPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyGalleryPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

/** A week-long pass for one gallery. Bound to the password itself: changing it locks everyone out. */
const PASS_TTL_S = 7 * 24 * 3600;
export const galleryCookie = (slug: string) => `immersia_g_${slug}`;

function passKey() {
  return createHash('sha256').update(`immersia-gallery:${env().BETTER_AUTH_SECRET}`).digest();
}

export function galleryPass(slug: string, passwordHash: string, nowS = Math.floor(Date.now() / 1000)): string {
  const exp = nowS + PASS_TTL_S;
  const sig = createHmac('sha256', passKey()).update(`${slug}|${exp}|${passwordHash}`).digest('base64url');
  return `${exp}.${sig}`;
}

export function validGalleryPass(
  slug: string,
  passwordHash: string,
  pass: string | undefined,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  const [expRaw, sig] = (pass ?? '').split('.');
  const exp = Number(expRaw);
  if (!sig || !Number.isInteger(exp) || exp < nowS) return false;
  const expected = createHmac('sha256', passKey()).update(`${slug}|${exp}|${passwordHash}`).digest();
  const given = Buffer.from(sig, 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const GALLERY_PASS_MAX_AGE_S = PASS_TTL_S;

/** The operator sets or removes the gallery password (SHR-5). */
export async function setGalleryPassword(
  organizationId: string,
  eventId: string,
  password: string | null,
): Promise<boolean> {
  const rows = await db()
    .update(event)
    .set({ galleryPasswordHash: password ? hashGalleryPassword(password) : null })
    .where(and(eq(event.id, eventId), eq(event.organizationId, organizationId)))
    .returning({ id: event.id });
  return rows.length > 0;
}

// -----------------------------------------------------------------------------------------------
// Items

export interface GalleryItem {
  id: string;
  linkId: string;
  shortCode: string;
  booth: BoothMode;
  thumb: { url: string; type: 'image' | 'video' };
  width: number;
  height: number;
  capturedAt: string;
}

export const GALLERY_PAGE = 48;

/** Sessions guests may browse: live, not expired, not hidden by the operator, not opted out. */
const publicSessions = (eventId: string) =>
  and(
    eq(captureSession.eventId, eventId),
    eq(captureSession.status, 'live'),
    isNull(captureSession.expiredAt),
    eq(captureSession.optedOutOfDisplay, false),
    notInArray(captureSession.displayStatus, ['hidden', 'opted_out']),
  );

/** Newest first; `cursor` is the last item of the previous page (`<capturedAt ISO>_<id>`). */
export async function galleryItems(
  eventId: string,
  opts: { cursor?: string | null; booth?: BoothMode | null; code?: string | null; limit?: number } = {},
): Promise<{ items: GalleryItem[]; next: string | null }> {
  const limit = opts.limit ?? GALLERY_PAGE;
  const conditions = [publicSessions(eventId)];
  const code = opts.code
    ?.toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 6);
  if (code) conditions.push(sql`${captureSession.shortCode} like ${`${code}%`}`);
  // LIV-13: an event can run both booths; a photo session is one with a strip or GIF.
  const photo = sql`exists (select 1 from ${output} o where o.session_id = ${captureSession.id} and o.kind in ('strip', 'gif'))`;
  if (opts.booth === 'photo') conditions.push(photo);
  if (opts.booth === 'video360') conditions.push(sql`not ${photo}`);
  const [cAt, cId] = (opts.cursor ?? '').split('_');
  if (cAt && cId && !Number.isNaN(Date.parse(cAt)))
    conditions.push(
      or(
        lt(captureSession.capturedAt, new Date(cAt)),
        and(eq(captureSession.capturedAt, new Date(cAt)), lt(captureSession.id, cId)),
      )!,
    );
  const sessions = await db()
    .select({
      id: captureSession.id,
      linkId: captureSession.linkId,
      shortCode: captureSession.shortCode,
      capturedAt: captureSession.capturedAt,
    })
    .from(captureSession)
    .where(and(...conditions))
    .orderBy(desc(captureSession.capturedAt), desc(captureSession.id))
    .limit(limit + 1);
  const page = sessions.slice(0, limit);
  const outputs = page.length
    ? await db()
        .select({
          sessionId: output.sessionId,
          id: output.id,
          kind: output.kind,
          key: output.objectKey,
          width: output.width,
          height: output.height,
        })
        .from(output)
        .where(
          and(
            inArray(
              output.sessionId,
              page.map((s) => s.id),
            ),
            isNotNull(output.uploadedAt),
          ),
        )
    : [];
  const items: GalleryItem[] = [];
  for (const s of page) {
    const own = outputs.filter((o) => o.sessionId === s.id);
    const booth = sessionBooth(own);
    const media = pickMedia(booth, own);
    if (!media) continue;
    // A still to look at: the video's poster, else the GIF or strip itself.
    const still = media.type === 'video' ? media.poster : media.main;
    const thumbOut = own.find((o) => o.id === (still ?? media.main).id)!;
    if (!thumbOut.key) continue;
    items.push({
      id: s.id,
      linkId: s.linkId,
      shortCode: s.shortCode,
      booth,
      thumb: { url: await presignView(thumbOut.key, 3600), type: still ? 'image' : 'video' },
      width: media.main.width!,
      height: media.main.height!,
      capturedAt: s.capturedAt.toISOString(),
    });
  }
  const last = page.at(-1);
  return { items, next: sessions.length > limit && last ? `${last.capturedAt.toISOString()}_${last.id}` : null };
}

// -----------------------------------------------------------------------------------------------
// Files for a ZIP (SHR-5 bulk download, EVT-4 export)

export interface ZipFile {
  name: string;
  url: string;
  bytes: number | null;
}

const ZIP_KINDS = ['mp4', 'strip', 'gif', 'boomerang', 'short_video'] as const;
const EXT: Record<(typeof ZIP_KINDS)[number], string> = {
  mp4: 'mp4',
  strip: 'jpg',
  gif: 'gif',
  boomerang: 'mp4',
  short_video: 'mp4',
};
export const ZIP_PAGE = 500;

/**
 * One page of full-quality files, oldest first so a long download names files in capture order.
 * `everything` (the operator's export) includes hidden and opted-out sessions; the public gallery
 * doesn't. Links are signed for two hours: plenty for a page.
 */
export async function zipFiles(
  eventId: string,
  opts: { everything: boolean; cursor?: string | null },
): Promise<{ files: ZipFile[]; next: string | null }> {
  const conditions = [
    opts.everything
      ? and(eq(captureSession.eventId, eventId), isNull(captureSession.expiredAt))
      : publicSessions(eventId),
    isNotNull(output.uploadedAt),
    inArray(output.kind, [...ZIP_KINDS]),
  ];
  if (opts.cursor && /^[0-9a-f-]{36}$/i.test(opts.cursor)) conditions.push(sql`${output.id} > ${opts.cursor}`);
  const rows = await db()
    .select({
      id: output.id,
      kind: output.kind,
      key: output.objectKey,
      bytes: output.bytes,
      shortCode: captureSession.shortCode,
      prefix: captureSession.filenamePrefix,
    })
    .from(output)
    .innerJoin(captureSession, eq(captureSession.id, output.sessionId))
    .where(and(...conditions))
    .orderBy(output.id)
    .limit(ZIP_PAGE + 1);
  const page = rows.slice(0, ZIP_PAGE);
  const files = await Promise.all(
    page
      .filter((r) => r.key)
      .map(async (r) => {
        const kind = r.kind as (typeof ZIP_KINDS)[number];
        return {
          // Folders by kind; the EVT-5 prefix keeps the operator's numbering.
          name: `${kind}/${r.prefix}${r.shortCode}-${kind}.${EXT[kind]}`,
          url: await presignView(r.key!, 7200),
          bytes: r.bytes,
        };
      }),
  );
  return { files, next: rows.length > ZIP_PAGE ? page.at(-1)!.id : null };
}

/** Event overview: counts for the gallery card. */
export async function galleryStats(eventId: string): Promise<{ items: number }> {
  const [row] = await db()
    .select({ items: sql<number>`count(*)`.mapWith(Number) })
    .from(captureSession)
    .where(publicSessions(eventId));
  return { items: row?.items ?? 0 };
}
