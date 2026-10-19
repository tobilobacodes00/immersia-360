import { describe, expect, it } from 'vitest';
import { gainEnvelope, type MusicSettings } from '../src/audio';

const m: MusicSettings = { trimStartMs: 0, trimEndMs: null, offsetMs: 0, fadeInMs: 500, fadeOutMs: 1000, volume: 0.8 };

describe('gainEnvelope (VID-6)', () => {
  it('fades in, holds, and fades out to the end of the video', () => {
    expect(gainEnvelope(m, 120, 12)).toEqual([
      [0, 0],
      [0.5, 0.8],
      [11, 0.8],
      [12, 0],
    ]);
  });

  it('starts at the offset and stops when the trimmed music runs out', () => {
    const env = gainEnvelope({ ...m, offsetMs: 2000, trimStartMs: 10_000, trimEndMs: 15_000 }, 120, 12);
    expect(env[0]![0]).toBe(2);
    expect(env.at(-1)![0]).toBe(7); // 2 s offset + 5 s of trimmed music
  });

  it('shortens fades that would overlap on a short clip', () => {
    const env = gainEnvelope({ ...m, fadeInMs: 5000, fadeOutMs: 5000 }, 120, 4);
    expect(env).toEqual([
      [0, 0],
      [2, 0.8],
      [2, 0.8],
      [4, 0],
    ]);
  });

  it('no fades means flat volume', () => {
    expect(gainEnvelope({ ...m, fadeInMs: 0, fadeOutMs: 0 }, 120, 10)).toEqual([
      [0, 0.8],
      [10, 0.8],
    ]);
  });

  it('returns nothing when the music starts after the video ends', () => {
    expect(gainEnvelope({ ...m, offsetMs: 20_000 }, 120, 10)).toEqual([]);
  });

  it('clamps volume to 0–1', () => {
    expect(gainEnvelope({ ...m, volume: 3, fadeInMs: 0, fadeOutMs: 0 }, 120, 10)[0]![1]).toBe(1);
  });
});
