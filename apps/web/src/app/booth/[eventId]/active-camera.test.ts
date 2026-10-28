import { describe, expect, it } from 'vitest';
import { zoomUnit } from './active-camera';

describe('zoomUnit', () => {
  it('a phone camera reports a multiplier: shown as ×', () => {
    expect(zoomUnit({ min: 1, max: 10 })).toBe('×');
    expect(zoomUnit({ min: 0.5, max: 5 })).toBe('×');
    expect(zoomUnit({ min: 1, max: 20 })).toBe('×');
  });

  it('a UVC webcam in Chrome reports a percentage scale: shown as %, never as "300×"', () => {
    // Logitech C920 and BRIO report {min: 100, max: 500, step: 1}.
    expect(zoomUnit({ min: 100, max: 500 })).toBe('%');
    expect(zoomUnit({ min: 100, max: 400 })).toBe('%');
  });
});
