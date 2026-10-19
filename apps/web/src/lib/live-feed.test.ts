import { describe, expect, it } from 'vitest';
import { DISPLAY_ITEM_LIMIT, type DisplayItem } from '@immersia/shared';
import { upsertItem } from './live-feed';

const item = (id: string, at: string): DisplayItem => ({
  id,
  booth: 'photo',
  shortCode: 'ABC234',
  link: `https://example.com/s/${id}`,
  media: { type: 'image', url: `/api/live/media/${id}`, poster: null, width: 600, height: 1800 },
  at,
});

describe('upsertItem (LIV-2, LIV-12)', () => {
  it('puts a new item first and replaces an existing one in place of its old entry', () => {
    const list = [item('b', '2026-10-19T10:00:02Z'), item('a', '2026-10-19T10:00:01Z')];
    expect(upsertItem(list, item('c', '2026-10-19T10:00:03Z')).map((i) => i.id)).toEqual(['c', 'b', 'a']);
    // An approved item is timed at approval: it jumps the queue.
    expect(upsertItem(list, item('a', '2026-10-19T10:00:09Z')).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('keeps at most DISPLAY_ITEM_LIMIT items', () => {
    let list: DisplayItem[] = [];
    for (let i = 0; i < DISPLAY_ITEM_LIMIT + 5; i++)
      list = upsertItem(list, item(`i${i}`, new Date(Date.UTC(2026, 9, 19, 10, 0, i)).toISOString()));
    expect(list).toHaveLength(DISPLAY_ITEM_LIMIT);
    expect(list[0]!.id).toBe(`i${DISPLAY_ITEM_LIMIT + 4}`);
  });
});
