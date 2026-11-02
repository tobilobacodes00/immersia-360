import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { footageGoneSql, footageIsGone, reelClipFate, reelFate, type FootageFacts } from './highlight-footage';
import { stateOf } from './share-state';

const now = new Date('2026-10-28T12:00:00Z');
const later = new Date('2026-11-28T12:00:00Z');
const earlier = new Date('2026-10-01T12:00:00Z');

/** A clip that is in the gallery. */
const inGallery: FootageFacts = {
  status: 'live',
  expiresAt: later,
  expiredAt: null,
  erasedAt: null,
  removedAt: null,
  removal: null,
  optedOutOfDisplay: false,
  displayStatus: 'shown',
};
const clip = (over: Partial<FootageFacts>): FootageFacts => ({ ...inGallery, ...over });

describe('what becomes of a highlight reel when one of its clips changes', () => {
  it('keeps a reel whose clips are all in the gallery, including one that never went to a screen', () => {
    expect(reelClipFate(inGallery, now)).toBe('keep');
    expect(reelClipFate(clip({ displayStatus: 'opted_out', optedOutOfDisplay: false }), now)).toBe('keep');
  });

  it('deletes the reel when a guest erased the session', () => {
    expect(reelClipFate(clip({ erasedAt: now, expiredAt: now }), now)).toBe('delete');
  });

  it('deletes the reel when a clip expires, by the sweep or by the clock before it', () => {
    expect(reelClipFate(clip({ expiredAt: earlier }), now)).toBe('delete');
    expect(reelClipFate(clip({ expiresAt: earlier }), now)).toBe('delete');
  });

  it('deletes the reel when the guest opted out of being shown', () => {
    expect(reelClipFate(clip({ optedOutOfDisplay: true, displayStatus: 'opted_out' }), now)).toBe('delete');
  });

  it('deletes the reel when the platform took a clip down, for policy or as illegal content', () => {
    expect(reelClipFate(clip({ removedAt: now, removal: 'policy' }), now)).toBe('delete');
    expect(reelClipFate(clip({ removedAt: now, removal: 'legal' }), now)).toBe('delete');
    // A removal with no recorded basis counts as a policy takedown (share-state.ts).
    expect(reelClipFate(clip({ removedAt: now, removal: null }), now)).toBe('delete');
  });

  it('only withholds the reel when the operator hid a clip: that is theirs to undo', () => {
    const hidden = clip({ removedAt: now, removal: 'operator' });
    expect(footageIsGone(hidden, now)).toBe(false);
    expect(reelClipFate(hidden, now)).toBe('withhold');
    expect(reelClipFate(clip({ displayStatus: 'hidden' }), now)).toBe('withhold');
  });

  it('lets a takedown, an erasure and an expiry win over an operator hide, as in the session-state model', () => {
    const hiddenAnd = (over: Partial<FootageFacts>) => clip({ removedAt: now, removal: 'operator', ...over });
    expect(reelClipFate(hiddenAnd({ erasedAt: now }), now)).toBe('delete');
    expect(reelClipFate(hiddenAnd({ expiredAt: earlier }), now)).toBe('delete');
    expect(reelClipFate(clip({ removedAt: now, removal: 'legal' }), now)).toBe('delete');
  });

  it('agrees with the session-state model on every state that withdraws footage', () => {
    // stateOf is the one source of truth: whatever it calls removed, erased or expired takes a reel down.
    const facts = (over: Partial<FootageFacts>) => ({ ...clip(over), ready: 2 });
    for (const over of [
      { removedAt: now, removal: 'legal' as const },
      { removedAt: now, removal: 'policy' as const },
      { erasedAt: now, expiredAt: now },
      { expiredAt: earlier },
      { expiresAt: earlier },
    ]) {
      const f = facts(over);
      expect(['removed', 'erased', 'expired']).toContain(stateOf(f, now));
      expect(reelClipFate(f, now), JSON.stringify(over)).toBe('delete');
    }
    // A hide is `hidden` in the model, and only withholds.
    expect(stateOf(facts({ removedAt: now, removal: 'operator' }), now)).toBe('hidden');
    // What it calls live or pending keeps the reel.
    expect(stateOf(facts({}), now)).toBe('live');
    expect(reelClipFate(facts({}), now)).toBe('keep');
  });

  it('gives a reel the worst fate of its clips', () => {
    expect(reelFate([])).toBe('keep');
    expect(reelFate(['keep', 'keep'])).toBe('keep');
    expect(reelFate(['keep', 'withhold'])).toBe('withhold');
    expect(reelFate(['withhold', 'delete', 'keep'])).toBe('delete');
  });
});

describe('the sweep: the same decision as SQL', () => {
  const text = new PgDialect().sqlToQuery(footageGoneSql).sql.replace(/\s+/g, ' ');

  it('deletes for erased, expired (flag or clock), opted out and platform-removed sessions', () => {
    expect(text).toContain('s.erased_at is not null');
    expect(text).toContain('s.expired_at is not null');
    expect(text).toContain('s.expires_at <= now()');
    expect(text).toContain('s.opted_out_of_display');
    expect(text).toContain("s.removed_at is not null and coalesce(s.removal, 'policy') <> 'operator'");
  });

  it("leaves an operator's hide alone", () => {
    expect(text).not.toMatch(/removal = 'operator'/);
    expect(text).not.toContain('display_status');
  });
});
