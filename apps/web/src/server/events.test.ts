import { describe, expect, it, vi } from 'vitest';
import { defaultOutputSettings, outputSettingsSchema } from '@immersia/shared';
import { mediaPatchSchema, withMedia } from './events';

// The server modules refuse to load outside a server bundle; here nothing touches the database.
vi.mock('server-only', () => ({}));

const A = '0198a3c0-1111-7000-8000-000000000001';
const B = '0198a3c0-2222-7000-8000-000000000002';

describe('withMedia: the setup screen saves the whole output section but never the media references', () => {
  it('keeps the stored backgrounds of both booths (CAP-10)', () => {
    const stored = defaultOutputSettings();
    stored.video360.background = { assetId: A };
    stored.photo.background = { color: '#1fa37a' };
    // A setup tab opened before the operator chose backgrounds: it holds "off" and sends it back.
    const stale = defaultOutputSettings();
    stale.video360.spinSeconds = 12;
    stale.photo.shots = 2;

    const saved = withMedia(stale, stored);
    expect(saved.video360.background).toEqual({ assetId: A });
    expect(saved.photo.background).toEqual({ color: '#1fa37a' });
    // What the setup screen does own still comes from it.
    expect(saved.video360.spinSeconds).toBe(12);
    expect(saved.photo.shots).toBe(2);
    // And the result is a complete, valid document.
    expect(outputSettingsSchema.safeParse(saved).success).toBe(true);
  });

  it('keeps a blur and keeps off, too', () => {
    const stored = defaultOutputSettings();
    stored.video360.background = { blur: true };
    const saved = withMedia(defaultOutputSettings(), stored);
    expect(saved.video360.background).toEqual({ blur: true });
    expect(saved.photo.background).toBeNull();
  });

  it('still keeps the other media references', () => {
    const stored = defaultOutputSettings();
    stored.video360.introAssetId = A;
    stored.video360.filterId = 'noir';
    stored.photo.layoutTemplateId = B;
    stored.photo.effectId = 'sparkle';
    const saved = withMedia(defaultOutputSettings(), stored);
    expect(saved.video360.introAssetId).toBe(A);
    expect(saved.video360.filterId).toBe('noir');
    expect(saved.photo.layoutTemplateId).toBe(B);
    expect(saved.photo.effectId).toBe('sparkle');
  });
});

describe('mediaPatchSchema: what the branding screen may change', () => {
  it('takes a background for each booth: a picture, a colour, a blur, or off', () => {
    expect(mediaPatchSchema.parse({ background: { assetId: A } })).toEqual({ background: { assetId: A } });
    expect(mediaPatchSchema.parse({ background: { color: '#ffffff' } })).toEqual({ background: { color: '#ffffff' } });
    expect(mediaPatchSchema.parse({ photoBackground: { blur: true } })).toEqual({ photoBackground: { blur: true } });
    expect(mediaPatchSchema.parse({ background: null, photoBackground: null })).toEqual({
      background: null,
      photoBackground: null,
    });
  });

  it('is a partial patch: a field that is absent is left alone, which null (off) is not', () => {
    expect(mediaPatchSchema.parse({})).toEqual({});
    expect('background' in mediaPatchSchema.parse({ cardSeconds: 2 })).toBe(false);
    expect(mediaPatchSchema.parse({ background: null })).toHaveProperty('background', null);
  });

  it('rejects malformed backgrounds', () => {
    for (const bad of [
      { background: { assetId: 'not-a-uuid' } },
      { background: { color: 'blue' } },
      { background: { blur: false } },
      { background: { blur: true, color: '#000000' } },
      { photoBackground: { assetId: A, blur: true } },
      { photoBackground: 'blur' },
    ])
      expect(mediaPatchSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});
