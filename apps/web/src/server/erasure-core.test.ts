import { describe, expect, it } from 'vitest';
import { LATE_UPLOAD_GRACE_MS, applyErasure, erasurePlan, purgeStage, uploadGate } from './erasure-core';

const t0 = new Date('2026-10-20T10:00:00Z');

describe('erasing a session (idempotent)', () => {
  it('marks a live session erased and expired in one step', () => {
    const plan = erasurePlan({ erasedAt: null, expiredAt: null }, t0);
    expect(plan).toEqual({
      already: false,
      patch: {
        erasedAt: t0,
        expiredAt: t0,
        status: 'expired',
        optedOutOfDisplay: true,
        displayStatus: 'opted_out',
      },
    });
  });

  it('keeps the time the expiry sweep already ended the session', () => {
    const earlier = new Date('2026-10-01T00:00:00Z');
    const plan = erasurePlan({ erasedAt: null, expiredAt: earlier }, t0);
    expect(plan).toMatchObject({ already: false, patch: { expiredAt: earlier, erasedAt: t0 } });
  });

  it('does nothing the second time, whoever asks and whenever', () => {
    const session = { erasedAt: null as Date | null, expiredAt: null as Date | null };
    const first = erasurePlan(session, t0);
    const after = applyErasure(session, first);
    expect(after.erasedAt).toEqual(t0);
    expect(erasurePlan(after, new Date(t0.getTime() + 60_000))).toEqual({ already: true });
    // Applying an "already" plan leaves the row exactly as it was (the first erasure time stands).
    expect(applyErasure(after, { already: true })).toBe(after);
  });
});

describe('a booth uploading for an erased session', () => {
  it('is refused once the session was erased, and allowed before', () => {
    expect(uploadGate({ erasedAt: null })).toBe('ok');
    expect(uploadGate({ erasedAt: t0 })).toBe('erased');
  });
});

describe('a booth uploading for a session the platform took down', () => {
  it('is refused for a policy or illegal takedown, as final as an erasure', () => {
    expect(uploadGate({ erasedAt: null, removedAt: t0, removal: 'policy' })).toBe('removed');
    expect(uploadGate({ erasedAt: null, removedAt: t0, removal: 'legal' })).toBe('removed');
  });

  it('keeps accepting uploads for a session its operator only hid (reversible, no files touched)', () => {
    expect(uploadGate({ erasedAt: null, removedAt: t0, removal: 'operator' })).toBe('ok');
  });

  it('reports a takedown ahead of an erasure, like the guest link does', () => {
    expect(uploadGate({ erasedAt: t0, removedAt: t0, removal: 'legal' })).toBe('removed');
    expect(uploadGate({ erasedAt: t0, removedAt: t0, removal: 'operator' })).toBe('erased');
  });
});

describe('cleaning up after an erasure', () => {
  it('deletes objects at once and keeps the rows until no signed upload can land', () => {
    expect(purgeStage(t0, t0)).toBe('objects');
    expect(purgeStage(t0, new Date(t0.getTime() + LATE_UPLOAD_GRACE_MS - 1))).toBe('objects');
    expect(purgeStage(t0, new Date(t0.getTime() + LATE_UPLOAD_GRACE_MS))).toBe('rows');
  });

  it('waits longer than a presigned upload is valid (one hour)', () => {
    expect(LATE_UPLOAD_GRACE_MS).toBeGreaterThan(60 * 60 * 1000);
  });
});
