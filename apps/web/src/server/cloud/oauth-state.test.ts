import { describe, expect, it } from 'vitest';
import { STATE_TTL_MS, signOAuthState, verifyOAuthState } from './oauth-state';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const claims = { org: 'org-1', user: 'user-1', provider: 'drive' as const };
const NOW = 1_800_000_000_000;

describe('OAuth state (signed, expiring, bound to org + user + provider)', () => {
  it('round-trips the claims', () => {
    const state = signOAuthState(claims, SECRET, NOW);
    expect(verifyOAuthState(state, SECRET, NOW + 1000)).toMatchObject({ ...claims, exp: NOW + STATE_TTL_MS });
  });

  it('is URL-safe and different every time', () => {
    const a = signOAuthState(claims, SECRET, NOW);
    const b = signOAuthState(claims, SECRET, NOW);
    expect(a).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(a).not.toBe(b);
  });

  it('expires after ten minutes', () => {
    const state = signOAuthState(claims, SECRET, NOW);
    expect(verifyOAuthState(state, SECRET, NOW + STATE_TTL_MS - 1)).not.toBeNull();
    expect(verifyOAuthState(state, SECRET, NOW + STATE_TTL_MS)).toBeNull();
    expect(verifyOAuthState(state, SECRET, NOW + 24 * 3600_000)).toBeNull();
  });

  it('rejects a different secret', () => {
    expect(verifyOAuthState(signOAuthState(claims, SECRET, NOW), SECRET + 'x', NOW)).toBeNull();
  });

  it('rejects a payload edited to name another organization, user or provider', () => {
    const [body, signature] = signOAuthState(claims, SECRET, NOW).split('.') as [string, string];
    const original = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>;
    for (const edit of [{ org: 'org-2' }, { user: 'user-2' }, { provider: 'dropbox' }, { exp: NOW + 10 ** 12 }]) {
      const forged = Buffer.from(JSON.stringify({ ...original, ...edit })).toString('base64url');
      expect(verifyOAuthState(`${forged}.${signature}`, SECRET, NOW), JSON.stringify(edit)).toBeNull();
    }
  });

  it('rejects a flipped signature, truncation and garbage', () => {
    const state = signOAuthState(claims, SECRET, NOW);
    // The first character carries full bits (the last one has unused padding bits).
    const [body, signature] = state.split('.') as [string, string];
    const flipped = `${body}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    for (const bad of [flipped, state.slice(0, -4), state.split('.')[0]!, '', '.', 'a.b', 'a.b.c', 'not a token']) {
      expect(verifyOAuthState(bad, SECRET, NOW), bad).toBeNull();
    }
  });
});
