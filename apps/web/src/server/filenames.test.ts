import { describe, expect, it } from 'vitest';
import { cloudFilename, eventFolderName } from './filenames';

const base = {
  prefix: '0042_',
  eventName: 'Boda de José & Ana',
  shortCode: 'K7QX9M',
  kind: 'small_mp4',
  mime: 'video/mp4',
  outputId: '0199f2a0-7c3d-7abc-8def-0123456789ab',
  sameKind: 1,
};

describe('cloud filenames', () => {
  it('uses the EVT-5 prefix, the event, the short code and the kind', () => {
    expect(cloudFilename(base)).toBe('0042_Boda-de-Jose-Ana-K7QX9M-small-mp4.mp4');
  });

  it('is unique per guest even without a prefix, and per output when a session repeats a kind', () => {
    const a = cloudFilename({ ...base, prefix: '' });
    const b = cloudFilename({ ...base, prefix: '', shortCode: 'PLM234' });
    expect(a).not.toBe(b);
    const first = cloudFilename({ ...base, sameKind: 2 });
    const second = cloudFilename({ ...base, sameKind: 2, outputId: '0199f2a0-7c3d-7abc-8def-0123456789cd' });
    expect(first).not.toBe(second);
    expect(first).toMatch(/-6789ab\.mp4$/);
  });

  it('is stable: the same output always gets the same name (retries find it by name)', () => {
    expect(cloudFilename(base)).toBe(cloudFilename({ ...base }));
  });

  it('falls back to .bin for an unknown type', () => {
    expect(cloudFilename({ ...base, mime: 'application/x-weird' }).endsWith('.bin')).toBe(true);
  });
});

describe('event folder names', () => {
  it('is "<event> <date>" with characters the clouds reject replaced', () => {
    expect(eventFolderName('Gala 360', '2026-10-19')).toBe('Gala 360 2026-10-19');
    expect(eventFolderName('Boda: Ana/Luis?', '2026-10-19')).toBe('Boda- Ana-Luis- 2026-10-19');
  });
});
