import { describe, expect, it } from 'vitest';
import { estimateBytes, messagingSize, outputSize, videoBitrate } from '../src/presets';

describe('output size (VID-10)', () => {
  it('9:16 is the default vertical frame', () => {
    expect(outputSize('1080p', '9:16')).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('720p', '9:16')).toEqual({ width: 720, height: 1280 });
    expect(outputSize('2160p', '9:16')).toEqual({ width: 2160, height: 3840 });
  });

  it('supports 1:1 and 16:9', () => {
    expect(outputSize('1080p', '1:1')).toEqual({ width: 1080, height: 1080 });
    expect(outputSize('1080p', '16:9')).toEqual({ width: 1920, height: 1080 });
  });
});

describe('bitrate presets (VID-8)', () => {
  it('Balanced lands in the PRD target of ~8–12 MB for a 15 s 1080p clip', () => {
    const mb = estimateBytes('balanced', 1080, 1920, 30, 15) / 1e6;
    expect(mb).toBeGreaterThanOrEqual(8);
    expect(mb).toBeLessThanOrEqual(12);
  });

  it('orders Small < Balanced < Original', () => {
    const s = videoBitrate('small', 1080, 1920, 30);
    const b = videoBitrate('balanced', 1080, 1920, 30);
    const o = videoBitrate('original', 1080, 1920, 30);
    expect(s).toBeLessThan(b);
    expect(b).toBeLessThan(o);
  });

  it('stays within sane bounds at the extremes', () => {
    expect(videoBitrate('small', 320, 240, 15)).toBe(1_500_000);
    expect(videoBitrate('original', 3840, 2160, 60)).toBe(50_000_000);
  });
});

describe('messaging copy (DL-8)', () => {
  it('scales the short side to 720 and keeps even dimensions', () => {
    expect(messagingSize(1080, 1920)).toEqual({ width: 720, height: 1280 });
    expect(messagingSize(720, 1280)).toEqual({ width: 720, height: 1280 });
    expect(messagingSize(2160, 3840)).toEqual({ width: 720, height: 1280 });
  });
});
