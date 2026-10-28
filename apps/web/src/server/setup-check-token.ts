import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The setup check's test QR (HLP-1). The code opens `/check/<token>` on a phone; the token is signed
 * (HMAC-SHA256) and short-lived, so only this server can make one, it names the device that is
 * waiting for the scan, and it dies on its own. Pure over the secret so it can be tested exactly.
 *
 * Shape: `<device id, 32 hex>.<nonce, 8 random bytes b64url>.<expiry in seconds, base36>.<signature>`
 */

export interface QrToken {
  deviceId: string;
  nonce: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export type QrTokenCheck = ({ ok: true } & QrToken) | { ok: false; reason: 'invalid' | 'expired' };

const keyFor = (secret: string) => createHmac('sha256', secret).update('immersia-setup-check-qr').digest();
const sign = (secret: string, payload: string) =>
  createHmac('sha256', keyFor(secret)).update(payload).digest().subarray(0, 16).toString('base64url');

const compact = (uuid: string) => uuid.replaceAll('-', '').toLowerCase();
const expand = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

const SHAPE = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{11})\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{22})$/;

export function mintQrToken(
  secret: string,
  deviceId: string,
  ttlS: number,
  now = Date.now(),
): { token: string; nonce: string; expiresAt: number } {
  const nonce = randomBytes(8).toString('base64url');
  const expSeconds = Math.floor(now / 1000) + ttlS;
  const payload = `${compact(deviceId)}.${nonce}.${expSeconds.toString(36)}`;
  return { token: `${payload}.${sign(secret, payload)}`, nonce, expiresAt: expSeconds * 1000 };
}

export function verifyQrToken(secret: string, token: string, now = Date.now()): QrTokenCheck {
  const m = SHAPE.exec(token);
  if (!m) return { ok: false, reason: 'invalid' };
  const [, hex, nonce, exp36, signature] = m as unknown as [string, string, string, string, string];
  const given = Buffer.from(signature);
  const want = Buffer.from(sign(secret, `${hex}.${nonce}.${exp36}`));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, reason: 'invalid' };
  const expiresAt = Number.parseInt(exp36, 36) * 1000;
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: 'invalid' };
  if (now > expiresAt) return { ok: false, reason: 'expired' };
  return { ok: true, deviceId: expand(hex), nonce, expiresAt };
}

/** A nonce as the poll route receives it: exactly what `mintQrToken` makes. */
export const isNonce = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v);
