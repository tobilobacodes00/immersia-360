import { describe, expect, it } from 'vitest';
import { stateOf } from './share-state';

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
