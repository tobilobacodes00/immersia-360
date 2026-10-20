import { describe, expect, it } from 'vitest';
import {
  backgroundSchema,
  defaultOutputSettings,
  outputSettingsSchema,
  photoSchema,
  video360Schema,
} from '../src/event';
import { backgroundAssetFits, mediaAssetRefs, unmetAssetRefs, type AssetRow } from '../src/media-refs';

const A = '0198a3c0-1111-7000-8000-000000000001';
const B = '0198a3c0-2222-7000-8000-000000000002';
const C = '0198a3c0-3333-7000-8000-000000000003';

const row = (id: string, type: string, mime: string): AssetRow => ({ id, type, mime });

describe('background settings (CAP-10)', () => {
  it('is off by default in both booths, and old stored settings without it still parse', () => {
    const out = defaultOutputSettings();
    expect(out.video360.background).toBeNull();
    expect(out.photo.background).toBeNull();
    // A document saved before CAP-10 has no such key.
    const { background: _360, ...video } = out.video360;
    const { background: _photo, ...photo } = out.photo;
    const legacy = outputSettingsSchema.parse({ video360: video, photo });
    expect(legacy.video360.background).toBeNull();
    expect(legacy.photo.background).toBeNull();
  });

  it('is one of a picture or video, a colour or a blur, or null', () => {
    expect(backgroundSchema.parse(null)).toBeNull();
    expect(backgroundSchema.parse({ assetId: A })).toEqual({ assetId: A });
    expect(backgroundSchema.parse({ color: '#1fa37a' })).toEqual({ color: '#1fa37a' });
    expect(backgroundSchema.parse({ color: '#1FA37A' })).toEqual({ color: '#1FA37A' });
    expect(backgroundSchema.parse({ blur: true })).toEqual({ blur: true });
  });

  it('rejects everything else', () => {
    for (const bad of [
      {},
      { blur: false },
      { blur: 1 },
      { assetId: 'not-a-uuid' },
      { assetId: A, color: '#000000' }, // two choices at once
      { assetId: A, blur: true },
      { color: 'red' },
      { color: '#fff' },
      { color: '#12345g' },
      { color: '#000000', extra: 1 },
      'blur',
      42,
      undefined,
    ])
      expect(backgroundSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('is part of both booths settings, and survives a round trip', () => {
    const video = video360Schema.parse({ background: { assetId: A } });
    expect(video.background).toEqual({ assetId: A });
    expect(video360Schema.parse(JSON.parse(JSON.stringify(video)))).toEqual(video);
    const photo = photoSchema.parse({ background: { blur: true } });
    expect(photo.background).toEqual({ blur: true });
    expect(photoSchema.safeParse({ background: { color: 'nope' } }).success).toBe(false);
  });
});

describe('which assets can be a background (the server checks every reference)', () => {
  it('a picture can be the background of either booth', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(backgroundAssetFits('video360', row(A, 'background', mime)), mime).toBe(true);
      expect(backgroundAssetFits('photo', row(A, 'background', mime)), mime).toBe(true);
    }
  });

  it('a video only plays behind the 360 booth: photo stills have no time to play it in', () => {
    for (const mime of ['video/mp4', 'video/webm']) {
      expect(backgroundAssetFits('video360', row(A, 'background', mime)), mime).toBe(true);
      expect(backgroundAssetFits('photo', row(A, 'background', mime)), mime).toBe(false);
    }
  });

  it('only assets uploaded as backgrounds count, and only pictures and videos', () => {
    for (const type of ['overlay', 'layout', 'intro', 'outro', 'audio', 'font', 'logo'])
      expect(backgroundAssetFits('video360', row(A, type, 'image/png')), type).toBe(false);
    expect(backgroundAssetFits('video360', row(A, 'background', 'audio/mpeg'))).toBe(false);
    expect(backgroundAssetFits('photo', row(A, 'background', 'font/woff2'))).toBe(false);
  });
});

describe('references a media patch makes', () => {
  it('names a field for each asset, and none for off, colour or blur', () => {
    expect(mediaAssetRefs({})).toEqual([]);
    expect(mediaAssetRefs({ background: null, photoBackground: null })).toEqual([]);
    expect(mediaAssetRefs({ background: { color: '#000000' }, photoBackground: { blur: true } })).toEqual([]);
    const refs = mediaAssetRefs({ background: { assetId: A }, photoBackground: { assetId: B } });
    expect(refs.map((r) => [r.id, r.field])).toEqual([
      [A, 'background'],
      [B, 'photoBackground'],
    ]);
  });

  it('keeps the existing slots: intro, outro and music', () => {
    const refs = mediaAssetRefs({ introAssetId: A, outroAssetId: B, music: { assetId: C }, background: null });
    expect(refs.map((r) => r.field)).toEqual(['introAssetId', 'outroAssetId', 'music']);
    const intro = refs[0]!;
    expect(intro.accepts(row(A, 'intro', 'video/mp4'))).toBe(true);
    expect(intro.accepts(row(A, 'outro', 'video/mp4'))).toBe(false);
    expect(refs[2]!.accepts(row(C, 'audio', 'audio/mpeg'))).toBe(true);
    expect(refs[2]!.accepts(row(C, 'logo', 'image/png'))).toBe(false);
  });
});

describe('ownership of a patch (organization, status and type checked by the server against these rows)', () => {
  const patch = { background: { assetId: A }, photoBackground: { assetId: B } };

  it('passes when both assets are the organization’s and suit their booths', () => {
    const rows = [row(A, 'background', 'video/mp4'), row(B, 'background', 'image/jpeg')];
    expect(unmetAssetRefs(mediaAssetRefs(patch), rows)).toEqual([]);
  });

  it('fails an asset the database did not return: another organization’s, deleted or still uploading', () => {
    // The server only looks among this organization's ready assets, so these simply are not there.
    expect(unmetAssetRefs(mediaAssetRefs(patch), [row(B, 'background', 'image/jpeg')])).toEqual(['background']);
    expect(unmetAssetRefs(mediaAssetRefs(patch), [])).toEqual(['background', 'photoBackground']);
  });

  it('fails the photo booth’s video, and an asset that is not a background', () => {
    expect(
      unmetAssetRefs(mediaAssetRefs(patch), [row(A, 'background', 'image/png'), row(B, 'background', 'video/mp4')]),
    ).toEqual(['photoBackground']);
    expect(
      unmetAssetRefs(mediaAssetRefs(patch), [row(A, 'overlay', 'image/png'), row(B, 'background', 'image/png')]),
    ).toEqual(['background']);
  });

  it('judges the same asset separately for each slot it is used in', () => {
    // One video used for both booths: fine for the 360 booth, not for the photo booth.
    const both = mediaAssetRefs({ background: { assetId: A }, photoBackground: { assetId: A } });
    expect(unmetAssetRefs(both, [row(A, 'background', 'video/webm')])).toEqual(['photoBackground']);
  });
});
