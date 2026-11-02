import { describe, expect, it } from 'vitest';
import { isServed, removalOf, stateHttpStatus, stateOf, type SessionFacts, type SessionState } from './share-state';

const now = new Date('2026-10-20T12:00:00Z');
const later = new Date('2026-11-20T12:00:00Z');
const earlier = new Date('2026-10-01T12:00:00Z');

describe('what a guest link shows (stateOf)', () => {
  it('waits, then shows files', () => {
    expect(stateOf({ expiresAt: later, expiredAt: null, erasedAt: null, ready: 0 }, now)).toBe('pending');
    expect(stateOf({ expiresAt: later, expiredAt: null, erasedAt: null, ready: 2 }, now)).toBe('live');
  });

  it('ends when retention runs out, by clock or by the sweep', () => {
    expect(stateOf({ expiresAt: earlier, expiredAt: null, erasedAt: null, ready: 2 }, now)).toBe('expired');
    expect(stateOf({ expiresAt: later, expiredAt: earlier, erasedAt: null, ready: 0 }, now)).toBe('expired');
  });

  it('says "deleted at your request" for an erased session, even though erasure also expires it', () => {
    expect(stateOf({ expiresAt: later, expiredAt: now, erasedAt: now, ready: 0 }, now)).toBe('erased');
    expect(stateOf({ expiresAt: earlier, expiredAt: earlier, erasedAt: now, ready: 3 }, now)).toBe('erased');
  });
});

describe('the session-state model: hidden and taken down', () => {
  const live = { expiresAt: later, expiredAt: null, erasedAt: null, ready: 2 };

  it('serves only live and pending sessions', () => {
    expect(isServed('live')).toBe(true);
    expect(isServed('pending')).toBe(true);
    for (const state of ['expired', 'erased', 'hidden', 'removed'] as const) expect(isServed(state), state).toBe(false);
  });

  it('an operator hide stops the link, whether or not files are ready', () => {
    const hidden = { ...live, removedAt: now, removal: 'operator' as const };
    expect(stateOf(hidden, now)).toBe('hidden');
    expect(stateOf({ ...hidden, ready: 0 }, now)).toBe('hidden');
    expect(removalOf(hidden)).toBe('operator');
  });

  it('a platform takedown is removed, for illegal content as for a policy violation', () => {
    expect(stateOf({ ...live, removedAt: now, removal: 'policy' }, now)).toBe('removed');
    expect(stateOf({ ...live, removedAt: now, removal: 'legal' }, now)).toBe('removed');
    // A row without a recorded basis is treated as a policy takedown, never as served.
    expect(stateOf({ ...live, removedAt: now, removal: null }, now)).toBe('removed');
  });

  it('a takedown outranks everything: it stays removed after the guest erases it, or it expires', () => {
    const taken = { removedAt: now, removal: 'legal' as const };
    expect(stateOf({ ...live, ...taken, erasedAt: now, expiredAt: now }, now)).toBe('removed');
    expect(stateOf({ expiresAt: earlier, expiredAt: earlier, erasedAt: null, ready: 1, ...taken }, now)).toBe(
      'removed',
    );
    // ...and it overrides an operator's earlier hide.
    expect(stateOf({ ...live, removedAt: now, removal: 'policy' }, now)).toBe('removed');
  });

  it('erasing a hidden session still erases it: "deleted at your request" outranks the hide', () => {
    expect(stateOf({ ...live, removedAt: earlier, removal: 'operator', erasedAt: now, expiredAt: now }, now)).toBe(
      'erased',
    );
  });

  it('a hide outranks expiry, and expiry still ends an unhidden session', () => {
    expect(stateOf({ ...live, expiresAt: earlier, removedAt: now, removal: 'operator' }, now)).toBe('hidden');
    expect(stateOf({ ...live, expiresAt: earlier }, now)).toBe('expired');
  });

  it('answers 451 for illegal content, 410 for every other state that is gone, 200 while served', () => {
    expect(stateHttpStatus('removed', 'legal')).toBe(451);
    expect(stateHttpStatus('removed', 'policy')).toBe(410);
    expect(stateHttpStatus('hidden', 'operator')).toBe(410);
    expect(stateHttpStatus('erased')).toBe(410);
    expect(stateHttpStatus('expired')).toBe(410);
    expect(stateHttpStatus('live')).toBe(200);
    expect(stateHttpStatus('pending')).toBe(200);
  });

  it('is one total order: every combination of facts lands in exactly the state the table says', () => {
    const removals = [null, 'operator', 'policy', 'legal'] as const;
    const expected = (f: { erased: boolean; removal: (typeof removals)[number]; expired: boolean; ready: number }) =>
      f.removal === 'policy' || f.removal === 'legal'
        ? 'removed'
        : f.erased
          ? 'erased'
          : f.removal === 'operator'
            ? 'hidden'
            : f.expired
              ? 'expired'
              : f.ready > 0
                ? 'live'
                : 'pending';
    for (const erased of [false, true])
      for (const removal of removals)
        for (const expired of [false, true])
          for (const ready of [0, 2]) {
            const facts: SessionFacts = {
              expiresAt: expired ? earlier : later,
              expiredAt: expired || erased ? earlier : null,
              erasedAt: erased ? now : null,
              removedAt: removal ? now : null,
              removal,
              ready,
            };
            const state: SessionState = stateOf(facts, now);
            // An erased session is always also expired (erasure sets expired_at), so "expired" folds into it.
            expect(state, JSON.stringify({ erased, removal, expired, ready })).toBe(
              expected({ erased, removal, expired: expired || erased, ready }),
            );
          }
  });
});
