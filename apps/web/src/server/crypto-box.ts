import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for secrets at rest (the Drive/Dropbox refresh tokens). Sealed form:
 * `v1.<iv>.<tag>.<ciphertext>`, each part base64url. A fresh random 96-bit IV per seal (never reused
 * under one key); the GCM tag authenticates the ciphertext and the optional `aad`, so a sealed
 * value copied onto another row (another organization, another provider) fails to open instead of
 * being used by the wrong account.
 *
 * Pure (the key is passed in): the callers decide where it comes from, and the format is versioned
 * so the key or the algorithm can be rotated without a flag day.
 */
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class CryptoBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoBoxError';
  }
}

/** A base64 key that must decode to exactly 32 bytes (`openssl rand -base64 32`). */
export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64.trim(), 'base64');
  if (key.length !== KEY_BYTES) throw new CryptoBoxError(`The key must be ${KEY_BYTES} bytes, got ${key.length}`);
  return key;
}

export function seal(plaintext: string, key: Buffer, aad?: string): string {
  if (key.length !== KEY_BYTES) throw new CryptoBoxError(`The key must be ${KEY_BYTES} bytes`);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const b64 = (b: Buffer) => b.toString('base64url');
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(ciphertext)].join('.');
}

/** Throws CryptoBoxError for anything that isn't a value sealed by this key with this `aad`. */
export function open(sealed: string, key: Buffer, aad?: string): string {
  if (key.length !== KEY_BYTES) throw new CryptoBoxError(`The key must be ${KEY_BYTES} bytes`);
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new CryptoBoxError('Unrecognised sealed value');
  const [, ivPart, tagPart, ctPart] = parts as [string, string, string, string];
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new CryptoBoxError('Unrecognised sealed value');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ctPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key, wrong context or tampering all look the same on purpose.
    throw new CryptoBoxError('Could not open the sealed value');
  }
}
