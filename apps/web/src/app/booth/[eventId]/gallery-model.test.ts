import { describe, expect, it } from 'vitest';
import type { LocalOutput, LocalSession } from '@immersia/offline';
import {
  MEMORY_EXPORT_WARN_BYTES,
  applyFilter,
  buildGalleryItems,
  countByFilter,
  eventSlug,
  extensionOf,
  localDateStamp,
  needsMemoryWarning,
  outputFilename,
  totalBytes,
  uploadState,
  zipEntries,
  zipFilename,
  type GalleryItem,
} from './gallery-model';

const output = (o: Partial<LocalOutput> & Pick<LocalOutput, 'id' | 'kind'>): LocalOutput => ({
  takeId: null,
  eventId: 'evt',
  path: `outputs/evt/${o.id}.mp4`,
  mime: 'video/mp4',
  bytes: 1000,
  width: 1080,
  height: 1920,
  durationMs: 0,
  createdAt: 1000,
  ...o,
});

const session = (s: Partial<LocalSession> & Pick<LocalSession, 'id'>): LocalSession => ({
  eventId: 'evt',
  linkId: 'AAAAAAAAAAAAAAAAAAAAAA',
  shortCode: 'K7M2QX',
  takeIds: [],
  capturedAt: 1000,
  optedOutOfDisplay: false,
  state: 'local',
  attempts: 0,
  nextAttemptAt: 0,
  createdAt: 1000,
  updatedAt: 1000,
  ...s,
});

const item = (i: Partial<GalleryItem> & Pick<GalleryItem, 'id' | 'kind'>): GalleryItem => ({
  mime: 'video/mp4',
  path: `outputs/evt/${i.id}.mp4`,
  bytes: 1000,
  width: 1080,
  height: 1920,
  durationMs: 0,
  createdAt: 1000,
  sessionId: 's1',
  linkId: 'AAAAAAAAAAAAAAAAAAAAAA',
  shortCode: 'K7M2QX',
  filenamePrefix: '',
  upload: 'local',
  poster: null,
  ...i,
});

describe('buildGalleryItems', () => {
  it('lists newest first and folds posters into the videos of their take', () => {
    const items = buildGalleryItems(
      [
        output({ id: 'mp4', kind: 'mp4', takeId: 't1', createdAt: 3000 }),
        output({
          id: 'poster',
          kind: 'poster',
          takeId: 't1',
          mime: 'image/jpeg',
          path: 'outputs/evt/poster.jpg',
          createdAt: 3001,
        }),
        output({ id: 'small', kind: 'small_mp4', takeId: 't1', createdAt: 3500 }),
        output({
          id: 'strip',
          kind: 'strip',
          sessionId: 's2',
          mime: 'image/jpeg',
          path: 'outputs/evt/strip.jpg',
          createdAt: 2000,
        }),
        output({
          id: 'gif',
          kind: 'gif',
          sessionId: 's2',
          mime: 'image/gif',
          path: 'outputs/evt/gif.gif',
          createdAt: 1000,
        }),
      ],
      [session({ id: 's1', takeIds: ['t1'] }), session({ id: 's2', shortCode: 'ABCDEF' })],
    );
    expect(items.map((i) => i.id)).toEqual(['small', 'mp4', 'strip', 'gif']);
    expect(items.find((i) => i.id === 'mp4')?.poster).toEqual({ path: 'outputs/evt/poster.jpg', mime: 'image/jpeg' });
    expect(items.find((i) => i.id === 'small')?.poster).toEqual({ path: 'outputs/evt/poster.jpg', mime: 'image/jpeg' });
    expect(items.find((i) => i.id === 'strip')?.poster).toBeNull();
  });

  it('takes the newest poster of a take', () => {
    const items = buildGalleryItems(
      [
        output({ id: 'mp4', kind: 'mp4', takeId: 't1', createdAt: 3000 }),
        output({ id: 'old', kind: 'poster', takeId: 't1', path: 'old.jpg', mime: 'image/jpeg', createdAt: 2000 }),
        output({ id: 'new', kind: 'poster', takeId: 't1', path: 'new.jpg', mime: 'image/jpeg', createdAt: 2500 }),
      ],
      [],
    );
    expect(items[0]?.poster?.path).toBe('new.jpg');
  });

  it("resolves an output's session by its take or by its own session id", () => {
    const [video, strip] = buildGalleryItems(
      [
        output({ id: 'v', kind: 'mp4', takeId: 't1', createdAt: 2 }),
        output({ id: 'p', kind: 'strip', sessionId: 's2', createdAt: 1 }),
      ],
      [
        session({ id: 's1', takeIds: ['t1'], linkId: 'LINK1', shortCode: 'AAA111', filenamePrefix: '0007_' }),
        session({ id: 's2', linkId: 'LINK2', shortCode: null }),
      ],
    );
    expect(video).toMatchObject({ sessionId: 's1', linkId: 'LINK1', shortCode: 'AAA111', filenamePrefix: '0007_' });
    expect(strip).toMatchObject({ sessionId: 's2', linkId: 'LINK2', shortCode: null, filenamePrefix: '' });
  });

  it('still lists an output whose session is gone', () => {
    const [orphan] = buildGalleryItems([output({ id: 'v', kind: 'mp4', takeId: 'gone' })], []);
    expect(orphan).toMatchObject({ sessionId: null, linkId: null, shortCode: null, upload: 'local' });
  });

  it('keeps one output per kind and take or session: a re-render replaces the one before', () => {
    const items = buildGalleryItems(
      [
        output({ id: 'a', kind: 'mp4', takeId: 't1', createdAt: 1 }),
        output({ id: 'b', kind: 'mp4', takeId: 't1', createdAt: 2 }),
        output({ id: 'c', kind: 'mp4', takeId: 't2', createdAt: 3 }),
        output({ id: 'd', kind: 'strip', sessionId: 's1', createdAt: 4 }),
        output({ id: 'e', kind: 'strip', sessionId: 's2', createdAt: 5 }),
      ],
      [],
    );
    expect(items.map((i) => i.id)).toEqual(['e', 'd', 'c', 'b']);
  });

  it('orders outputs made in the same millisecond by id, newest id first', () => {
    const items = buildGalleryItems(
      [
        output({ id: '0001', kind: 'gif', sessionId: 's1', createdAt: 5 }),
        output({ id: '0002', kind: 'strip', sessionId: 's1', createdAt: 5 }),
      ],
      [],
    );
    expect(items.map((i) => i.id)).toEqual(['0002', '0001']);
  });
});

describe('uploadState', () => {
  it('reads the output first, then its session', () => {
    expect(uploadState({ uploadedAt: 5 }, session({ id: 's', state: 'failed' }))).toBe('uploaded');
    expect(uploadState({}, session({ id: 's', state: 'failed' }))).toBe('failed');
    expect(uploadState({}, session({ id: 's', state: 'registered' }))).toBe('uploading');
    expect(uploadState({ serverId: 'x' }, session({ id: 's', state: 'local' }))).toBe('uploading');
    expect(uploadState({}, session({ id: 's', state: 'local' }))).toBe('local');
    expect(uploadState({}, undefined)).toBe('local');
  });
});

describe('filters', () => {
  const items = [
    item({ id: '1', kind: 'mp4' }),
    item({ id: '2', kind: 'small_mp4' }),
    item({ id: '3', kind: 'strip' }),
    item({ id: '4', kind: 'gif' }),
    item({ id: '5', kind: 'boomerang' }),
    item({ id: '6', kind: 'short_video' }),
    item({ id: '7', kind: 'strip' }),
  ];

  it('groups videos, strips and GIFs & motion', () => {
    expect(applyFilter(items, 'all')).toHaveLength(7);
    expect(applyFilter(items, 'videos').map((i) => i.id)).toEqual(['1', '2']);
    expect(applyFilter(items, 'strips').map((i) => i.id)).toEqual(['3', '7']);
    expect(applyFilter(items, 'motion').map((i) => i.id)).toEqual(['4', '5', '6']);
  });

  it('counts each filter', () => {
    expect(countByFilter(items)).toEqual({ all: 7, videos: 2, strips: 2, motion: 3 });
    expect(countByFilter([])).toEqual({ all: 0, videos: 0, strips: 0, motion: 0 });
  });
});

describe('file names', () => {
  it('names a file by prefix, kind and short code', () => {
    expect(outputFilename(item({ id: 'a', kind: 'mp4' }))).toBe('mp4-K7M2QX.mp4');
    expect(outputFilename(item({ id: 'a', kind: 'small_mp4', filenamePrefix: '0007_' }))).toBe(
      '0007_small-mp4-K7M2QX.mp4',
    );
    expect(
      outputFilename(
        item({ id: 'a', kind: 'strip', mime: 'image/jpeg', path: 'outputs/evt/a.jpg', shortCode: 'ABC234' }),
      ),
    ).toBe('strip-ABC234.jpg');
  });

  it('falls back to the tail of the output id while a session has no code', () => {
    const gif = { id: '01926f3a-7c1e-7d2b-9a40-1234567890ab', kind: 'gif', mime: 'image/gif', path: 'a.gif' } as const;
    expect(outputFilename(item({ ...gif, shortCode: null }))).toBe('gif-567890AB.gif');
  });

  it('never lets a prefix or code leak a path separator', () => {
    const name = outputFilename(item({ id: 'a', kind: 'mp4', filenamePrefix: '../x:', shortCode: 'A\\B' }));
    expect(name).not.toMatch(/[\\/:]/);
  });

  it('reads the extension from the stored path, else the MIME type', () => {
    expect(extensionOf({ path: 'outputs/evt/a.JPG', mime: 'image/jpeg' })).toBe('jpg');
    expect(extensionOf({ path: 'outputs/evt/a', mime: 'image/png' })).toBe('png');
    expect(extensionOf({ path: 'outputs/evt/a', mime: 'application/x-unknown' })).toBe('bin');
  });

  it('slugs the event name for the archive', () => {
    expect(eventSlug('Zoë & Marc’s Wedding!')).toBe('Zoe-Marc-s-Wedding');
    expect(eventSlug('   ')).toBe('immersia');
    expect(eventSlug('日本語')).toBe('immersia');
    expect(eventSlug('a'.repeat(39) + ' b')).toBe('a'.repeat(39));
    expect(eventSlug('x'.repeat(80))).toHaveLength(40);
  });

  it("dates the archive by the operator's own calendar day", () => {
    expect(localDateStamp(new Date(2026, 9, 19, 23, 59))).toBe('2026-10-19');
    expect(localDateStamp(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
    expect(zipFilename('Birthday Bash', new Date(2026, 9, 19, 12))).toBe('Birthday-Bash-2026-10-19.zip');
  });
});

describe('zipEntries', () => {
  it('puts each kind in its own folder, oldest first', () => {
    const entries = zipEntries([
      item({ id: 'g', kind: 'gif', createdAt: 5, shortCode: 'GGG222', mime: 'image/gif', path: 'g.gif' }),
      item({ id: 's2', kind: 'strip', createdAt: 9, shortCode: 'SSS222', mime: 'image/jpeg', path: 's2.jpg' }),
      item({ id: 'v', kind: 'mp4', createdAt: 7, shortCode: 'VVV222' }),
      item({ id: 's1', kind: 'strip', createdAt: 2, shortCode: 'SSS333', mime: 'image/jpeg', path: 's1.jpg' }),
      item({ id: 'm', kind: 'small_mp4', createdAt: 8, shortCode: 'VVV222' }),
    ]);
    expect(entries.map((e) => e.path)).toEqual([
      'videos/mp4-VVV222.mp4',
      'videos-small/small-mp4-VVV222.mp4',
      'strips/strip-SSS333.jpg',
      'strips/strip-SSS222.jpg',
      'gifs/gif-GGG222.gif',
    ]);
    expect(entries[2]).toMatchObject({ id: 's1', source: { path: 's1.jpg', mime: 'image/jpeg' }, lastModified: 2 });
  });

  it('keeps every name unique, ignoring case', () => {
    const same = { kind: 'strip', mime: 'image/jpeg', path: 'x.jpg' } as const;
    const entries = zipEntries([
      item({ id: '1', createdAt: 1, shortCode: 'abc234', ...same }),
      item({ id: '2', createdAt: 2, shortCode: 'ABC234', ...same }),
      item({ id: '3', createdAt: 3, shortCode: 'ABC234', ...same }),
    ]);
    expect(entries.map((e) => e.path)).toEqual([
      'strips/strip-abc234.jpg',
      'strips/strip-ABC234-2.jpg',
      'strips/strip-ABC234-3.jpg',
    ]);
  });

  it('is empty for nothing selected, and sums the bytes it will read', () => {
    expect(zipEntries([])).toEqual([]);
    const entries = zipEntries([item({ id: '1', kind: 'mp4', bytes: 300 }), item({ id: '2', kind: 'gif', bytes: 20 })]);
    expect(totalBytes(entries)).toBe(320);
  });
});

describe('memory warning', () => {
  it('starts above 1.5 GB', () => {
    expect(needsMemoryWarning(MEMORY_EXPORT_WARN_BYTES)).toBe(false);
    expect(needsMemoryWarning(MEMORY_EXPORT_WARN_BYTES + 1)).toBe(true);
  });
});
