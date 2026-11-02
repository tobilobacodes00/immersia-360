import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CryptoBoxError, open, parseKey, seal } from './crypto-box';

const key = () => randomBytes(32);

describe('crypto-box (AES-256-GCM)', () => {
  it('round-trips, including non-ASCII and empty values', () => {
    const k = key();
    for (const secret of ['1//0gRefreshTokenExample-abc_DEF', 'tökén ✓ 日本語', '']) {
      expect(open(seal(secret, k), k)).toBe(secret);
    }
  });

  it('uses the versioned v1.<iv>.<tag>.<ciphertext> form with a 12-byte IV and a fresh IV every time', () => {
    const k = key();
    const a = seal('same', k);
    const b = seal('same', k);
    const [version, iv, tag, ct] = a.split('.');
    expect(version).toBe('v1');
    expect(Buffer.from(iv!, 'base64url')).toHaveLength(12);
    expect(Buffer.from(tag!, 'base64url')).toHaveLength(16);
    expect(ct).toBeTruthy();
    expect(a).not.toBe(b);
    expect(a).not.toContain('same');
  });

  it('detects tampering with any part', () => {
    const k = key();
    const parts = seal('refresh-token', k).split('.');
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    for (const i of [1, 2, 3]) {
      const tampered = parts.map((p, j) => (j === i ? flip(p) : p)).join('.');
      expect(() => open(tampered, k), `part ${i}`).toThrow(CryptoBoxError);
    }
    // Truncated ciphertext too.
    expect(() => open([...parts.slice(0, 3), parts[3]!.slice(0, -2)].join('.'), k)).toThrow(CryptoBoxError);
  });

  it('refuses a different key', () => {
    const sealed = seal('refresh-token', key());
    expect(() => open(sealed, key())).toThrow(CryptoBoxError);
  });

  it('binds the value to its context: a copy on another row does not open', () => {
    const k = key();
    const sealed = seal('refresh-token', k, 'org-1:drive');
    expect(open(sealed, k, 'org-1:drive')).toBe('refresh-token');
    expect(() => open(sealed, k, 'org-2:drive')).toThrow(CryptoBoxError);
    expect(() => open(sealed, k)).toThrow(CryptoBoxError);
  });

  it('rejects malformed input and unknown versions without leaking detail', () => {
    const k = key();
    for (const bad of ['', 'nope', 'v1.a.b', 'v2.a.b.c', 'v1.AAAA.AAAA.AAAA']) {
      expect(() => open(bad, k), bad).toThrow(CryptoBoxError);
    }
  });

  it('only accepts 32-byte keys', () => {
    expect(() => seal('x', randomBytes(16))).toThrow(CryptoBoxError);
    expect(() => open('v1.a.b.c', randomBytes(31))).toThrow(CryptoBoxError);
    expect(parseKey(randomBytes(32).toString('base64'))).toHaveLength(32);
    expect(() => parseKey(randomBytes(24).toString('base64'))).toThrow(CryptoBoxError);
    expect(() => parseKey('not base64 at all!')).toThrow(CryptoBoxError);
  });
});
