import { describe, expect, it } from 'vitest';
import { isNonce, mintQrToken, verifyQrToken } from './setup-check-token';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const DEVICE = '0194a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);

describe('setup check QR token (HLP-1)', () => {
  it('round-trips the device, the nonce and the expiry', () => {
    const minted = mintQrToken(SECRET, DEVICE, 600, NOW);
    const checked = verifyQrToken(SECRET, minted.token, NOW + 1000);
    expect(checked).toEqual({ ok: true, deviceId: DEVICE, nonce: minted.nonce, expiresAt: NOW + 600_000 });
    expect(isNonce(minted.nonce)).toBe(true);
  });

  it('is short enough for a small QR code and safe in a URL path', () => {
    const { token } = mintQrToken(SECRET, DEVICE, 600, NOW);
    expect(token.length).toBeLessThan(90);
    expect(token).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('expires on its own', () => {
    const { token } = mintQrToken(SECRET, DEVICE, 600, NOW);
    expect(verifyQrToken(SECRET, token, NOW + 600_000)).toMatchObject({ ok: true });
    expect(verifyQrToken(SECRET, token, NOW + 601_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a token signed with another secret, or edited after signing', () => {
    const { token } = mintQrToken(SECRET, DEVICE, 600, NOW);
    expect(verifyQrToken('another-secret-0123456789abcdef012345', token, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    const [device, nonce, exp, sig] = token.split('.') as [string, string, string, string];
    const otherDevice = device.replace(/^./, device.startsWith('a') ? 'b' : 'a');
    expect(verifyQrToken(SECRET, [otherDevice, nonce, exp, sig].join('.'), NOW).ok).toBe(false);
    // Stretching the lifetime must not work either.
    const longer = (Number.parseInt(exp, 36) + 86_400).toString(36);
    expect(verifyQrToken(SECRET, [device, nonce, longer, sig].join('.'), NOW).ok).toBe(false);
  });

  it('refuses anything that is not a token', () => {
    for (const bad of [
      '',
      'abc',
      'a.b.c.d',
      `${'0'.repeat(32)}.${'A'.repeat(11)}.zz.${'B'.repeat(22)}`,
      '../../etc/passwd',
    ])
      expect(verifyQrToken(SECRET, bad, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('only accepts well-formed nonces', () => {
    expect(isNonce('abcDEF123_-')).toBe(true);
    expect(isNonce('short')).toBe(false);
    expect(isNonce('has space!!')).toBe(false);
    expect(isNonce(42)).toBe(false);
  });
});
