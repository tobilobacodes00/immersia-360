import { describe, expect, it } from 'vitest';
import {
  SHORT_CODE_ALPHABET,
  filenamePrefix,
  formatShortCode,
  isLinkId,
  newLinkId,
  newShortCode,
  normalizeShortCode,
  uuidv7,
} from '../src/ids';

describe('link ids (DL-14)', () => {
  it('are 22 base64url characters carrying 128 bits', () => {
    for (let i = 0; i < 500; i++) {
      const id = newLinkId();
      expect(id).toHaveLength(22);
      expect(isLinkId(id)).toBe(true);
    }
  });

  it('are unique across a large sample', () => {
    const seen = new Set(Array.from({ length: 20_000 }, newLinkId));
    expect(seen.size).toBe(20_000);
  });

  it('rejects malformed ids, including a final character that would carry >128 bits', () => {
    expect(isLinkId('short')).toBe(false);
    expect(isLinkId('A'.repeat(21) + 'B')).toBe(false);
    expect(isLinkId('A'.repeat(21) + 'Q')).toBe(true);
    expect(isLinkId('A'.repeat(20) + '/A')).toBe(false);
  });
});

describe('short codes (DL-2)', () => {
  it('excludes look-alike characters', () => {
    for (const c of '01OIL') expect(SHORT_CODE_ALPHABET).not.toContain(c);
    expect(new Set(SHORT_CODE_ALPHABET).size).toBe(SHORT_CODE_ALPHABET.length);
  });

  it('only uses the alphabet and is 6 long', () => {
    for (let i = 0; i < 2000; i++) {
      const c = newShortCode();
      expect(c).toMatch(new RegExp(`^[${SHORT_CODE_ALPHABET}]{6}$`));
    }
  });

  it('is roughly uniform over the alphabet (no modulo bias)', () => {
    const counts = new Map<string, number>();
    const n = 60_000;
    for (let i = 0; i < n / 6; i++) for (const ch of newShortCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const expected = n / SHORT_CODE_ALPHABET.length;
    for (const ch of SHORT_CODE_ALPHABET) {
      const got = counts.get(ch) ?? 0;
      expect(Math.abs(got - expected) / expected).toBeLessThan(0.12);
    }
  });

  it('normalises guest input', () => {
    expect(normalizeShortCode('k7m-2qx')).toBe('K7M2QX');
    expect(normalizeShortCode(' K7M 2QX ')).toBe('K7M2QX');
    expect(normalizeShortCode('K7M2Q')).toBeNull();
    expect(normalizeShortCode('K7M2Q0')).toBeNull();
    expect(normalizeShortCode('K7M2QXX')).toBeNull();
  });

  it('formats for display', () => {
    expect(formatShortCode('K7M2QX')).toBe('K7M-2QX');
  });
});

describe('uuidv7', () => {
  it('is a valid v7 UUID carrying the timestamp', () => {
    const t = Date.UTC(2026, 9, 16, 12, 0, 0);
    const id = uuidv7(t);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(t);
  });

  it('sorts by creation time', () => {
    const a = uuidv7(1000);
    const b = uuidv7(2000);
    expect(a < b).toBe(true);
  });
});

describe('filename prefix (EVT-5)', () => {
  it('pads the sequence', () => {
    expect(filenamePrefix(true, 1)).toBe('0001_');
    expect(filenamePrefix(true, 12345)).toBe('12345_');
    expect(filenamePrefix(false, 1)).toBe('');
  });
});
