/**
 * Identifiers.
 *
 * - Link IDs (DL-14): 128 random bits, base64url, 22 characters. Minted on the booth device so a
 *   guest's QR exists before the network does; unguessable, so they double as the access secret
 *   for a session page.
 * - Short codes (DL-2): 6 characters from an alphabet with no look-alikes (no 0/O, 1/I/L), typed by
 *   guests at the short URL. 31^6 ≈ 887M codes. They are NOT minted offline at random: each device
 *   reserves a pool from the server while online, so codes stay globally unique.
 * - Row IDs: UUIDv7, so primary keys are time-ordered (index locality) and creatable on the device.
 */

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]! + B64URL[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]!;
  }
  return out;
}

const LINK_ID_RE = /^[A-Za-z0-9_-]{22}$/;

/** A new 128-bit session link ID. */
export function newLinkId(): string {
  return toBase64Url(randomBytes(16));
}

export function isLinkId(value: string): boolean {
  // 16 bytes → 22 chars; the last char only carries 2 bits, so it must be one of A, Q, g, w.
  return LINK_ID_RE.test(value) && 'AQgw'.includes(value[21]!);
}

export const SHORT_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const SHORT_CODE_LENGTH = 6;
const SHORT_CODE_RE = new RegExp(`^[${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}}$`);

/** An unbiased random short code (rejection sampling, so no character is favoured). */
export function newShortCode(): string {
  const n = SHORT_CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < SHORT_CODE_LENGTH) {
    for (const b of randomBytes(SHORT_CODE_LENGTH * 2)) {
      if (b >= limit) continue;
      out += SHORT_CODE_ALPHABET[b % n];
      if (out.length === SHORT_CODE_LENGTH) break;
    }
  }
  return out;
}

/**
 * Normalise what a guest typed: case-insensitive, spaces and dashes ignored. Returns null when the
 * input cannot be a code, so the lookup (and its rate limit) is never spent on garbage.
 */
export function normalizeShortCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return SHORT_CODE_RE.test(code) ? code : null;
}

/** Display form, e.g. "K7M-2QX", easier to read aloud and type. */
export function formatShortCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/** RFC 9562 UUIDv7: 48-bit ms timestamp, then random bits. */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  const ts = BigInt(now);
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Event filename prefix (EVT-5): 1 → "0001_". Empty when the event has no prefix. */
export function filenamePrefix(enabled: boolean, sequence: number, width = 4): string {
  return enabled ? `${String(sequence).padStart(width, '0')}_` : '';
}
