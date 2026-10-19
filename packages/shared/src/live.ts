/**
 * Live Display, Sharing Station and the realtime hub (LIV-1..13, SHR-4, KIO-3).
 *
 * The database is the source of truth: which capture sessions are on screen, each display's layout
 * and settings. The realtime hub (one Cloudflare Durable Object per event, apps/realtime) only fans
 * changes out to connected screens within a second; a screen that can't hold a socket polls the feed
 * instead and still meets LIV-2's five seconds. Messages are small: an item, a removal, or "your
 * configuration changed, refetch it".
 */
import { z } from 'zod';

export const DISPLAY_LAYOUTS = ['spotlight', 'mosaic', 'ticker', 'counter'] as const;
export type DisplayLayout = (typeof DISPLAY_LAYOUTS)[number];

/** LIV-12: a screen keeps (and loops) at most this many recent items. */
export const DISPLAY_ITEM_LIMIT = 200;

/** Pairing codes (LIV-1): six characters from the short-code alphabet, valid for ten minutes. */
export const PAIRING_TTL_MS = 10 * 60_000;

/** One capture session on screen: a 360 video, or a photo session's GIF or strip. */
export interface DisplayItem {
  /** The capture session id. */
  id: string;
  booth: 'video360' | 'photo';
  /** LIV-4: the session's own link and short code, shown as a QR beside the item. */
  shortCode: string;
  link: string;
  media: {
    type: 'video' | 'gif' | 'image';
    /** Same-origin, signed, long-lived: the screen can fetch and cache it for offline looping. */
    url: string;
    poster: string | null;
    width: number;
    height: number;
  };
  /** When it went on screen (ISO): newest first, and LIV-2's "new items jump the queue". */
  at: string;
}

export const displayItemSchema = z.object({
  id: z.uuid(),
  booth: z.enum(['video360', 'photo']),
  shortCode: z.string(),
  link: z.url(),
  media: z.object({
    type: z.enum(['video', 'gif', 'image']),
    url: z.string(),
    poster: z.string().nullable(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  at: z.iso.datetime(),
});

/** What a screen needs besides its items (LIV-3, 5, 9, 10). */
export interface DisplayConfig {
  displayId: string | null;
  name: string;
  layout: DisplayLayout;
  settings: {
    dwellSeconds: number;
    videosMuted: boolean;
    qrSize: 's' | 'm' | 'l';
    qrPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    verticalFill: 'blur' | 'columns';
  };
  event: {
    id: string;
    name: string;
    hashtag: string;
    theme: { accent: string; background: string; ink: string; font: 'sans' | 'serif' };
    logoUrl: string | null;
    /** A photo or looping video behind the layout (LIV-9). */
    background: { url: string; type: 'image' | 'video' } | null;
    backgroundMusicUrl: string | null;
    /** LIV-5: the event gallery, as a persistent corner QR. */
    galleryUrl: string;
    /** Counter layout: total moments captured. */
    moments: number;
    /** Items only show while the event is live and Live Display is on (PRD privacy note). */
    live: boolean;
  };
}

export interface DisplayFeed {
  config: DisplayConfig;
  /** Newest first, at most DISPLAY_ITEM_LIMIT. */
  items: DisplayItem[];
  /** The realtime hub's position when this feed was read: resume the socket from here. */
  seq: number;
  /** WebSocket URL of the event's hub, or null when the hub isn't configured (polling only). */
  socket: string | null;
}

// -----------------------------------------------------------------------------------------------
// The hub protocol

export type LiveRole = 'display' | 'station' | 'operator';

/** Messages the hub sends to screens. Every one carries the event log position it was written at. */
export type LiveMessage =
  /** Sent on connect: the hub's current position, after any replay. */
  | { type: 'hello'; seq: number }
  | { type: 'item'; seq: number; item: DisplayItem }
  | { type: 'remove'; seq: number; id: string }
  /** A display's layout or settings, or the event's branding, changed: refetch the feed's config. */
  | { type: 'config'; seq: number; displayId: string | null }
  /** Operators only: the approve-first queue changed (LIV-7). */
  | { type: 'queue'; seq: number }
  /** The client's position is older than the hub remembers: refetch the whole feed. */
  | { type: 'reset'; seq: number };

/** What the web server posts to the hub (a message without its position; the hub assigns it). */
export type LivePublish =
  | { type: 'item'; item: DisplayItem }
  | { type: 'remove'; id: string }
  | { type: 'config'; displayId: string | null }
  | { type: 'queue' };

export const livePublishSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('item'), item: displayItemSchema }),
  z.object({ type: z.literal('remove'), id: z.uuid() }),
  z.object({ type: z.literal('config'), displayId: z.uuid().nullable() }),
  z.object({ type: z.literal('queue') }),
]);

/** Which roles receive a message: operators see everything, screens never see the queue. */
export function deliversTo(message: LivePublish, role: LiveRole): boolean {
  return message.type !== 'queue' || role === 'operator';
}

// -----------------------------------------------------------------------------------------------
// Tokens: HMAC-SHA256 over a small JSON payload, verifiable in Node, browsers and Workers alike.

export interface LiveTokenPayload {
  v: 1;
  eventId: string;
  role: LiveRole;
  /** Display id, operator user id or booth device id. */
  sub: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function hmac(secret: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return b64url(new Uint8Array(sig));
}

/** Constant-time check (crypto.subtle.verify) of an HMAC made by `hmac`. */
export async function verifyHmac(secret: string, data: string, signature: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(signature), enc.encode(data));
  } catch {
    return false;
  }
}

export async function signLiveToken(payload: Omit<LiveTokenPayload, 'v'>, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ v: 1, ...payload })));
  return `${body}.${await hmac(secret, body)}`;
}

const tokenPayloadSchema = z.object({
  v: z.literal(1),
  eventId: z.uuid(),
  role: z.enum(['display', 'station', 'operator']),
  sub: z.string().min(1),
  exp: z.number().int(),
});

export async function verifyLiveToken(
  token: string,
  secret: string,
  nowS = Math.floor(Date.now() / 1000),
): Promise<LiveTokenPayload | null> {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  if (!(await verifyHmac(secret, body, sig))) return null;
  try {
    const parsed = tokenPayloadSchema.safeParse(JSON.parse(new TextDecoder().decode(fromB64url(body))));
    if (!parsed.success || parsed.data.exp < nowS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Server → hub requests are signed over `<unix seconds>.<body>` and refused after five minutes. */
export const PUBLISH_WINDOW_S = 300;

export async function signPublish(body: string, secret: string, nowS = Math.floor(Date.now() / 1000)) {
  return { timestamp: String(nowS), signature: await hmac(secret, `${nowS}.${body}`) };
}

export async function verifyPublish(
  body: string,
  timestamp: string,
  signature: string,
  secret: string,
  nowS = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowS - ts) > PUBLISH_WINDOW_S) return false;
  return verifyHmac(secret, `${ts}.${body}`, signature);
}
