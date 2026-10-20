import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import {
  DISPLAY_ITEM_LIMIT,
  PAIRING_TTL_MS,
  brandingSchema,
  displaySettingsSchema,
  galleryUrl,
  hmac,
  newShortCode,
  sessionUrl,
  signLiveToken,
  signPublish,
  uuidv7,
  verifyHmac,
  type DisplayConfig,
  type DisplayFeed,
  type DisplayItem,
  type DisplayLayout,
  type DisplaySettings,
  type LivePublish,
  type LiveRole,
} from '@immersia/shared';
import { env } from './env';
import type { Operator } from './session';
import { presignView } from './storage';

const { event, captureSession, output, display, displayPairing, asset } = schema;

export type DisplayRow = typeof display.$inferSelect;
type EventRow = typeof event.$inferSelect;

// -----------------------------------------------------------------------------------------------
// Secrets and the hub

/** The hub's secret when it is configured; otherwise one derived from the auth secret (local use only). */
function liveSecret(): string {
  const e = env();
  return (
    e.REALTIME_SIGNING_SECRET ??
    createHash('sha256').update(`immersia-live:${e.BETTER_AUTH_SECRET}`).digest('base64url')
  );
}

const hub = () => {
  const e = env();
  return e.REALTIME_URL && e.REALTIME_SIGNING_SECRET ? e.REALTIME_URL.replace(/\/$/, '') : null;
};

/**
 * Tell the event's connected screens (LIV-2). Best effort: the database already holds the change,
 * and a screen that misses a message catches up from the feed (on reconnect, or by polling).
 */
export async function publish(eventId: string, message: LivePublish): Promise<void> {
  const base = hub();
  if (!base) return;
  const body = JSON.stringify(message);
  try {
    const { timestamp, signature } = await signPublish(body, liveSecret());
    const res = await fetch(`${base}/events/${eventId}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-live-timestamp': timestamp, 'x-live-signature': signature },
      body,
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.warn('[live] hub refused a message', res.status);
  } catch (err) {
    console.warn('[live] hub unreachable', err instanceof Error ? err.message : err);
  }
}

/** A socket address for one screen, with a token valid for a day (screens refetch the feed far sooner). */
async function socketFor(eventId: string, role: LiveRole, sub: string): Promise<string | null> {
  const base = hub();
  if (!base) return null;
  const token = await signLiveToken({ eventId, role, sub, exp: Math.floor(Date.now() / 1000) + 86_400 }, liveSecret());
  return `${base.replace(/^http/, 'ws')}/events/${eventId}/socket?token=${encodeURIComponent(token)}`;
}

// -----------------------------------------------------------------------------------------------
// Signed media URLs: same-origin, cacheable by the screen, revocable by hiding the item

const MEDIA_TTL_S = 7 * 24 * 3600;

async function mediaUrl(outputId: string): Promise<string> {
  // Bucketed to the day, so an item's URL is stable for a day and screens' caches stay warm.
  const exp = (Math.floor(Date.now() / 86_400_000) + 8) * 86_400;
  const sig = await hmac(liveSecret(), `media:${outputId}:${exp}`);
  return `/api/live/media/${outputId}?e=${exp}&s=${sig}`;
}

/** The storage URL for a signed media request, or null if the item is no longer on screen. */
export async function resolveMedia(outputId: string, exp: number, sig: string): Promise<string | null> {
  if (!Number.isInteger(exp) || exp < Date.now() / 1000 || exp > Date.now() / 1000 + MEDIA_TTL_S + 86_400) return null;
  if (!(await verifyHmac(liveSecret(), `media:${outputId}:${exp}`, sig))) return null;
  const [row] = await db()
    .select({ key: output.objectKey })
    .from(output)
    .innerJoin(captureSession, eq(captureSession.id, output.sessionId))
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(
      and(
        eq(output.id, outputId),
        isNotNull(output.uploadedAt),
        eq(captureSession.displayStatus, 'shown'),
        isNull(captureSession.expiredAt),
        eq(event.liveDisplayEnabled, true),
      ),
    )
    .limit(1);
  return row?.key ? presignView(row.key, 300) : null;
}

// -----------------------------------------------------------------------------------------------
// Items

type OutputLite = { id: string; kind: string; width: number | null; height: number | null };

/** Which booth made a session (LIV-13: one event can run both): photo sessions have a strip. */
export function sessionBooth(outputs: { kind: string }[]): EventRow['mode'] {
  return outputs.some((o) => o.kind === 'strip' || o.kind === 'gif') ? 'photo' : 'video360';
}

/** The media a session shows on screen: the light video for a 360, the GIF (or strip) for photos. */
export function pickMedia(booth: EventRow['mode'], outputs: OutputLite[]) {
  const of = (kind: string) => outputs.find((o) => o.kind === kind && o.width && o.height);
  if (booth === 'video360') {
    const video = of('small_mp4') ?? of('mp4');
    return video ? { main: video, type: 'video' as const, poster: of('poster') ?? null } : null;
  }
  const gif = of('gif');
  if (gif) return { main: gif, type: 'gif' as const, poster: of('strip') ?? null };
  const boomerang = of('boomerang') ?? of('short_video');
  if (boomerang) return { main: boomerang, type: 'video' as const, poster: of('strip') ?? null };
  const strip = of('strip');
  return strip ? { main: strip, type: 'image' as const, poster: null } : null;
}

async function uploadedOutputs(sessionIds: string[]) {
  if (!sessionIds.length) return new Map<string, OutputLite[]>();
  const rows = await db()
    .select({
      sessionId: output.sessionId,
      id: output.id,
      kind: output.kind,
      width: output.width,
      height: output.height,
    })
    .from(output)
    .where(and(inArray(output.sessionId, sessionIds), isNotNull(output.uploadedAt)));
  const map = new Map<string, OutputLite[]>();
  for (const r of rows) map.set(r.sessionId, [...(map.get(r.sessionId) ?? []), r]);
  return map;
}

async function toItems(
  sessions: { id: string; shortCode: string; linkId: string; displayedAt: Date | null; capturedAt: Date }[],
  origin: string,
): Promise<DisplayItem[]> {
  const outputs = await uploadedOutputs(sessions.map((s) => s.id));
  const items: DisplayItem[] = [];
  for (const s of sessions) {
    const own = outputs.get(s.id) ?? [];
    const booth = sessionBooth(own);
    const media = pickMedia(booth, own);
    if (!media) continue;
    items.push({
      id: s.id,
      booth,
      shortCode: s.shortCode,
      link: sessionUrl(origin, s.linkId, 'display'),
      media: {
        type: media.type,
        url: await mediaUrl(media.main.id),
        poster: media.poster ? await mediaUrl(media.poster.id) : null,
        width: media.main.width!,
        height: media.main.height!,
      },
      at: (s.displayedAt ?? s.capturedAt).toISOString(),
    });
  }
  return items;
}

const sessionCols = {
  id: captureSession.id,
  shortCode: captureSession.shortCode,
  linkId: captureSession.linkId,
  displayedAt: captureSession.displayedAt,
  capturedAt: captureSession.capturedAt,
};

/** LIV-12: the newest items on screen, newest first. */
async function shownItems(ev: EventRow, origin: string): Promise<DisplayItem[]> {
  if (!ev.liveDisplayEnabled || ev.status === 'archived') return [];
  const sessions = await db()
    .select(sessionCols)
    .from(captureSession)
    .where(
      and(
        eq(captureSession.eventId, ev.id),
        eq(captureSession.displayStatus, 'shown'),
        isNull(captureSession.expiredAt),
      ),
    )
    .orderBy(desc(captureSession.displayedAt))
    .limit(DISPLAY_ITEM_LIMIT);
  return toItems(sessions, origin);
}

/**
 * Decide whether a session goes on screen, once its media has landed (called after every upload).
 * Auto-publish shows it at once; approve-first leaves it in the operator's queue (LIV-7). A session
 * captured while Live Display was off is never shown: its guest wasn't told it might be.
 */
export async function refreshSessionItem(sessionId: string, origin: string): Promise<void> {
  const [row] = await db()
    .select({ session: captureSession, ev: event })
    .from(captureSession)
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(eq(captureSession.id, sessionId))
    .limit(1);
  if (!row) return;
  const { session, ev } = row;
  // An erased session (privacy) is gone for good: a late upload from a booth must not bring it back.
  if (session.erasedAt) return;
  if (session.displayStatus === 'hidden' || session.displayStatus === 'opted_out') return;
  if (session.optedOutOfDisplay || !ev.liveDisplayEnabled) {
    await db().update(captureSession).set({ displayStatus: 'opted_out' }).where(eq(captureSession.id, sessionId));
    return;
  }
  const own = (await uploadedOutputs([sessionId])).get(sessionId) ?? [];
  const media = pickMedia(sessionBooth(own), own);
  if (!media) return;
  if (session.displayStatus === 'shown') {
    // Better media arrived (a photo session's GIF after its strip): refresh the item in place.
    const [item] = await toItems([session], origin);
    if (item) await publish(ev.id, { type: 'item', item });
    return;
  }
  if (ev.moderation === 'approve') return publish(ev.id, { type: 'queue' });
  const [updated] = await db()
    .update(captureSession)
    .set({ displayStatus: 'shown', displayedAt: new Date() })
    .where(and(eq(captureSession.id, sessionId), eq(captureSession.displayStatus, 'pending')))
    .returning(sessionCols);
  if (!updated) return;
  const [item] = await toItems([updated], origin);
  if (item) await publish(ev.id, { type: 'item', item });
}

// -----------------------------------------------------------------------------------------------
// Feeds

async function eventConfig(ev: EventRow, origin: string, d: DisplayRow | null): Promise<DisplayConfig> {
  const branding = brandingSchema.parse(ev.branding);
  const settings: DisplaySettings = displaySettingsSchema.parse(d?.settings ?? {});
  const assetIds = [branding.logoAssetId, branding.attract.backgroundAssetId, settings.backgroundMusicAssetId].filter(
    (x): x is string => !!x,
  );
  const assets = assetIds.length
    ? await db()
        .select({ id: asset.id, key: asset.objectKey, mime: asset.mime })
        .from(asset)
        .where(
          and(
            inArray(asset.id, assetIds),
            eq(asset.organizationId, ev.organizationId),
            eq(asset.status, 'ready'),
            isNull(asset.deletedAt),
          ),
        )
    : [];
  const view = async (id: string | null) => {
    const a = id ? assets.find((x) => x.id === id) : undefined;
    return a ? { url: await presignView(a.key, 6 * 3600), mime: a.mime } : null;
  };
  const [logo, background, music] = await Promise.all([
    view(branding.logoAssetId),
    view(branding.attract.backgroundAssetId),
    view(settings.backgroundMusicAssetId),
  ]);
  const [counted] = await db()
    .select({ moments: sql<number>`count(*)`.mapWith(Number) })
    .from(captureSession)
    .where(eq(captureSession.eventId, ev.id));
  return {
    displayId: d?.id ?? null,
    name: d?.name ?? ev.name,
    layout: (d?.layout ?? 'spotlight') as DisplayLayout,
    settings: {
      dwellSeconds: settings.dwellSeconds,
      videosMuted: settings.videosMuted,
      qrSize: settings.qrSize,
      qrPosition: settings.qrPosition,
      verticalFill: settings.verticalFill,
    },
    event: {
      id: ev.id,
      name: ev.name,
      hashtag: branding.hashtag,
      theme: branding.theme,
      logoUrl: logo?.url ?? null,
      background: background
        ? { url: background.url, type: background.mime.startsWith('video/') ? 'video' : 'image' }
        : null,
      backgroundMusicUrl: music?.url ?? null,
      galleryUrl: galleryUrl(origin, ev.gallerySlug, 'display'),
      moments: counted?.moments ?? 0,
      live: ev.liveDisplayEnabled && ev.status !== 'archived',
    },
  };
}

export async function displayFeed(d: DisplayRow, origin: string): Promise<DisplayFeed | null> {
  const [ev] = await db().select().from(event).where(eq(event.id, d.eventId)).limit(1);
  if (!ev) return null;
  const [config, items, socket] = await Promise.all([
    eventConfig(ev, origin, d),
    shownItems(ev, origin),
    socketFor(ev.id, 'display', d.id),
  ]);
  return { config, items, socket };
}

/** The Sharing Station (SHR-4) and the operator's control page read the event's feed. */
export async function eventFeed(
  organizationId: string,
  eventId: string,
  origin: string,
  role: 'station' | 'operator',
  sub: string,
): Promise<DisplayFeed | null> {
  const [ev] = await db()
    .select()
    .from(event)
    .where(and(eq(event.id, eventId), eq(event.organizationId, organizationId)))
    .limit(1);
  if (!ev) return null;
  const [config, items, socket] = await Promise.all([
    eventConfig(ev, origin, null),
    shownItems(ev, origin),
    socketFor(ev.id, role, sub),
  ]);
  return { config, items, socket };
}

// -----------------------------------------------------------------------------------------------
// Pairing and displays (LIV-1, LIV-11)

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createPairing(op: Operator, eventId: string): Promise<{ code: string; expiresAt: Date } | null> {
  const [ev] = await db()
    .select({ id: event.id })
    .from(event)
    .where(and(eq(event.id, eventId), eq(event.organizationId, op.organizationId)))
    .limit(1);
  if (!ev) return null;
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newShortCode();
    const inserted = await db()
      .insert(displayPairing)
      .values({ code, eventId, createdBy: op.userId, expiresAt })
      .onConflictDoNothing()
      .returning({ code: displayPairing.code });
    if (inserted.length) return { code, expiresAt };
  }
  throw new Error('could not mint a pairing code');
}

/** The TV types the code (or opens the pairing QR): it becomes a display, no login needed. */
export async function claimPairing(
  code: string,
): Promise<{ token: string; displayId: string } | 'invalid' | 'expired'> {
  const normalized = code.trim().toUpperCase();
  return db().transaction(async (tx) => {
    const [pairing] = await tx
      .select()
      .from(displayPairing)
      .where(and(eq(displayPairing.code, normalized), isNull(displayPairing.claimedAt)))
      .for('update');
    if (!pairing) return 'invalid' as const;
    if (pairing.expiresAt.getTime() < Date.now()) return 'expired' as const;
    const [existing] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(display)
      .where(eq(display.eventId, pairing.eventId));
    const token = randomBytes(32).toString('base64url');
    const id = uuidv7();
    await tx.insert(display).values({
      id,
      eventId: pairing.eventId,
      name: `Display ${(existing?.count ?? 0) + 1}`,
      layout: 'spotlight',
      settings: displaySettingsSchema.parse({}),
      tokenHash: hashToken(token),
    });
    await tx
      .update(displayPairing)
      .set({ claimedAt: new Date(), displayId: id })
      .where(eq(displayPairing.code, normalized));
    return { token, displayId: id };
  });
}

/** The display a TV's token belongs to, unless it was removed. Marks it seen (at most once a minute). */
export async function displayByToken(token: string | null): Promise<DisplayRow | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const [row] = await db()
    .select()
    .from(display)
    .where(and(eq(display.tokenHash, hashToken(token)), isNull(display.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 60_000)
    await db().update(display).set({ lastSeenAt: new Date() }).where(eq(display.id, row.id));
  return row;
}

export async function listDisplays(organizationId: string, eventId: string): Promise<DisplayRow[]> {
  return db()
    .select({ display })
    .from(display)
    .innerJoin(event, eq(event.id, display.eventId))
    .where(and(eq(display.eventId, eventId), eq(event.organizationId, organizationId), isNull(display.revokedAt)))
    .orderBy(display.pairedAt)
    .then((rows) => rows.map((r) => r.display));
}

async function ownedDisplay(organizationId: string, displayId: string) {
  const [row] = await db()
    .select({ display })
    .from(display)
    .innerJoin(event, eq(event.id, display.eventId))
    .where(and(eq(display.id, displayId), eq(event.organizationId, organizationId), isNull(display.revokedAt)))
    .limit(1);
  return row?.display ?? null;
}

/** LIV-3, LIV-10, LIV-11: each display has its own layout and playback settings, switched live. */
export async function updateDisplay(
  organizationId: string,
  displayId: string,
  patch: { name?: string; layout?: DisplayLayout; settings?: Partial<DisplaySettings> },
): Promise<boolean> {
  const d = await ownedDisplay(organizationId, displayId);
  if (!d) return false;
  const settings = patch.settings ? displaySettingsSchema.parse({ ...d.settings, ...patch.settings }) : undefined;
  await db()
    .update(display)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.layout ? { layout: patch.layout } : {}),
      ...(settings ? { settings } : {}),
    })
    .where(eq(display.id, displayId));
  await publish(d.eventId, { type: 'config', displayId });
  return true;
}

/** The TV loses access at once: its next feed request fails and it returns to the pairing screen. */
export async function removeDisplay(organizationId: string, displayId: string): Promise<boolean> {
  const d = await ownedDisplay(organizationId, displayId);
  if (!d) return false;
  await db().update(display).set({ revokedAt: new Date() }).where(eq(display.id, displayId));
  await publish(d.eventId, { type: 'config', displayId });
  return true;
}

// -----------------------------------------------------------------------------------------------
// Moderation (LIV-7) and the guest's opt-out (LIV-8)

export interface QueueEntry extends DisplayItem {
  status: 'pending' | 'shown' | 'hidden';
}

/** The control page's lists: awaiting approval, on screen, hidden. */
export async function moderationLists(
  organizationId: string,
  eventId: string,
  origin: string,
): Promise<{ pending: QueueEntry[]; shown: QueueEntry[]; hidden: QueueEntry[] } | null> {
  const [ev] = await db()
    .select()
    .from(event)
    .where(and(eq(event.id, eventId), eq(event.organizationId, organizationId)))
    .limit(1);
  if (!ev) return null;
  const list = async (status: 'pending' | 'shown' | 'hidden') => {
    const sessions = await db()
      .select(sessionCols)
      .from(captureSession)
      .where(
        and(
          eq(captureSession.eventId, eventId),
          eq(captureSession.displayStatus, status),
          eq(captureSession.optedOutOfDisplay, false),
          isNull(captureSession.expiredAt),
        ),
      )
      .orderBy(desc(status === 'pending' ? captureSession.capturedAt : captureSession.displayedAt))
      .limit(DISPLAY_ITEM_LIMIT);
    // Pending sessions without their media yet aren't in the queue: there is nothing to approve.
    return (await toItems(sessions, origin)).map((item) => ({ ...item, status }));
  };
  const [pending, shown, hidden] = await Promise.all([list('pending'), list('shown'), list('hidden')]);
  return { pending, shown, hidden };
}

/** Approve (or restore) shows the item as new; hide takes it off every screen at once. */
export async function moderate(
  organizationId: string,
  sessionId: string,
  action: 'show' | 'hide',
  origin: string,
): Promise<boolean> {
  const [row] = await db()
    .select({ session: captureSession, ev: event })
    .from(captureSession)
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(and(eq(captureSession.id, sessionId), eq(event.organizationId, organizationId)))
    .limit(1);
  if (!row || row.session.erasedAt || row.session.displayStatus === 'opted_out' || row.session.optedOutOfDisplay)
    return false;
  if (action === 'hide') {
    await db().update(captureSession).set({ displayStatus: 'hidden' }).where(eq(captureSession.id, sessionId));
    await publish(row.ev.id, { type: 'remove', id: sessionId });
  } else {
    const [updated] = await db()
      .update(captureSession)
      .set({ displayStatus: 'shown', displayedAt: new Date() })
      .where(eq(captureSession.id, sessionId))
      .returning(sessionCols);
    const [item] = await toItems([updated!], origin);
    if (item) await publish(row.ev.id, { type: 'item', item });
  }
  await publish(row.ev.id, { type: 'queue' });
  return true;
}

/** LIV-8 from the booth's result screen. Opting out is final for this session. */
export async function optOutOfDisplay(organizationId: string, sessionId: string): Promise<boolean> {
  const rows = await db()
    .update(captureSession)
    .set({ optedOutOfDisplay: true, displayStatus: 'opted_out' })
    .where(
      and(
        eq(captureSession.id, sessionId),
        sql`${captureSession.eventId} in (select ${event.id} from ${event} where ${event.organizationId} = ${organizationId})`,
      ),
    )
    .returning({ eventId: captureSession.eventId });
  if (!rows[0]) return false;
  await publish(rows[0].eventId, { type: 'remove', id: sessionId });
  await publish(rows[0].eventId, { type: 'queue' });
  return true;
}

/**
 * Privacy erasure: take a session off every screen and out of the operator's approval queue at
 * once. The database already excludes it from the feed (the session is expired), so a screen that
 * misses this message drops it on its next refetch; this makes it immediate.
 */
export async function removeSessionItem(eventId: string, sessionId: string): Promise<void> {
  await publish(eventId, { type: 'remove', id: sessionId });
  await publish(eventId, { type: 'queue' });
}

/** Live Display on/off and the moderation mode (screen 23); screens refetch their configuration. */
export async function setLiveOptions(
  organizationId: string,
  eventId: string,
  patch: { enabled?: boolean; moderation?: 'auto' | 'approve' },
): Promise<boolean> {
  const rows = await db()
    .update(event)
    .set({
      ...(patch.enabled !== undefined ? { liveDisplayEnabled: patch.enabled } : {}),
      ...(patch.moderation ? { moderation: patch.moderation } : {}),
    })
    .where(and(eq(event.id, eventId), eq(event.organizationId, organizationId)))
    .returning({ id: event.id });
  if (!rows[0]) return false;
  await publish(eventId, { type: 'config', displayId: null });
  return true;
}

/** Displays seen in the last two minutes count as connected on the control page. */
export const ONLINE_WINDOW_MS = 2 * 60_000;
export const isOnline = (d: DisplayRow) => !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS;

/**
 * A feed's ETag. Storage links (logo, background, music) are re-signed on every read, so they're
 * compared without their signatures; the socket address carries a fresh token and is left out.
 * Without this an event with branding files would never answer a poll with 304.
 */
export function feedEtag(feed: DisplayFeed): string {
  const stable = JSON.stringify([feed.config, feed.items], (_key, value: unknown) =>
    typeof value === 'string' && /^https?:\/\//.test(value) ? value.split('?')[0] : value,
  );
  return `"${createHash('sha1').update(stable).digest('base64url')}"`;
}
