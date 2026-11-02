import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { galleryExclusion, isGalleryListed, publicSessions, type GalleryFacts } from './gallery-filter';

const now = new Date('2026-10-28T12:00:00Z');
const later = new Date('2026-11-28T12:00:00Z');
const earlier = new Date('2026-10-01T12:00:00Z');

/** A session the gallery lists: live, in retention, nothing said against it. */
const listed: GalleryFacts = {
  status: 'live',
  expiresAt: later,
  expiredAt: null,
  erasedAt: null,
  removedAt: null,
  optedOutOfDisplay: false,
  displayStatus: 'shown',
};
const with_ = (over: Partial<GalleryFacts>): GalleryFacts => ({ ...listed, ...over });

describe('which sessions the client gallery lists', () => {
  it('lists a live session whatever the Live Display did with it, as long as it was not hidden there', () => {
    for (const displayStatus of ['pending', 'shown'] as const)
      expect(isGalleryListed(with_({ displayStatus }), now), displayStatus).toBe(true);
  });

  it('lists a session captured while the Live Display was off (display_status "opted_out", the guest never opted out)', () => {
    // refreshSessionItem writes `opted_out` for these so the guest never appears on a screen they were not told about.
    // That is the Live Display's business: the gallery has no such guest to protect, and the highlight reel is built from it.
    const neverOnAScreen = with_({ displayStatus: 'opted_out', optedOutOfDisplay: false });
    expect(isGalleryListed(neverOnAScreen, now)).toBe(true);
    expect(galleryExclusion(neverOnAScreen, now)).toBeNull();
  });

  it('leaves out a guest who opted out of being shown', () => {
    const optedOut = with_({ optedOutOfDisplay: true, displayStatus: 'opted_out' });
    expect(isGalleryListed(optedOut, now)).toBe(false);
    expect(galleryExclusion(optedOut, now)).toBe('guest-did-not-opt-out');
    // The flag decides, whatever the display status says.
    expect(isGalleryListed(with_({ optedOutOfDisplay: true, displayStatus: 'shown' }), now)).toBe(false);
  });

  it('leaves out what the operator hid in the Live Display moderation', () => {
    expect(galleryExclusion(with_({ displayStatus: 'hidden' }), now)).toBe('operator-did-not-hide-from-display');
  });

  it('serves only what the session-state model serves: not hidden, taken down, erased or expired', () => {
    expect(galleryExclusion(with_({ removedAt: now }), now)).toBe('not-removed');
    expect(galleryExclusion(with_({ erasedAt: now, expiredAt: now }), now)).toBe('not-swept');
    expect(galleryExclusion(with_({ erasedAt: now }), now)).toBe('not-erased');
    expect(galleryExclusion(with_({ expiredAt: earlier }), now)).toBe('not-swept');
    expect(galleryExclusion(with_({ status: 'pending' }), now)).toBe('has-a-file');
  });

  it('stops listing a session when its retention ends, without waiting for the hourly sweep', () => {
    const pastRetention = with_({ expiresAt: earlier, expiredAt: null });
    expect(isGalleryListed(pastRetention, now)).toBe(false);
    expect(galleryExclusion(pastRetention, now)).toBe('not-past-retention');
    expect(isGalleryListed(with_({ expiresAt: now }), now)).toBe(false);
  });
});

describe('the same rule as a SQL condition (what the gallery, ZIP, count and highlight reel query)', () => {
  const query = new PgDialect().sqlToQuery(publicSessions('0198a3c0-1111-7000-8000-000000000001')!);

  it('reads the guest opt-out flag and nothing about display_status "opted_out"', () => {
    expect(query.sql).toContain('"capture_session"."opted_out_of_display" = $');
    expect(query.params).toContain(false);
    expect(query.params).not.toContain('opted_out');
  });

  it('excludes only the operator-hidden display status', () => {
    expect(query.sql).toContain('"capture_session"."display_status" <> $');
    expect(query.sql).not.toMatch(/display_status" (not )?in/i);
    expect(query.params).toContain('hidden');
    // Of the display statuses, only `hidden` is a parameter at all.
    for (const status of ['pending', 'shown', 'opted_out']) expect(query.params).not.toContain(status);
  });

  it('scopes to the event and applies the session-state conditions', () => {
    expect(query.sql).toContain('"capture_session"."event_id" = $');
    expect(query.params).toContain('0198a3c0-1111-7000-8000-000000000001');
    expect(query.sql).toContain('"capture_session"."status" = $');
    expect(query.params).toContain('live');
    for (const column of ['expired_at', 'erased_at', 'removed_at'])
      expect(query.sql, column).toContain(`"capture_session"."${column}" is null`);
    expect(query.sql).toContain('"capture_session"."expires_at" > now()');
  });
});
