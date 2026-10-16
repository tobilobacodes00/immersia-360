import { describe, expect, it } from 'vitest';
import { extensionFor, pickRecordingMime, recordingBitrate } from '../src/recorder';
import { classifyLens, toCameraError } from '../src/camera';

describe('recording format', () => {
  it('prefers WebM (incremental chunks, crash-safe), falls back to MP4', () => {
    expect(pickRecordingMime(() => true)).toBe('video/webm;codecs=vp9');
    expect(pickRecordingMime((m) => m.includes('vp8'))).toBe('video/webm;codecs=vp8');
    expect(pickRecordingMime((m) => m.startsWith('video/mp4'))).toBe('video/mp4;codecs=avc1.640028');
    expect(pickRecordingMime((m) => m === 'video/mp4')).toBe('video/mp4');
    expect(pickRecordingMime(() => false)).toBeNull();
  });

  it('chooses a generous but bounded bitrate', () => {
    expect(recordingBitrate(1920, 1080, 60)).toBeGreaterThan(12_000_000);
    expect(recordingBitrate(1920, 1080, 60)).toBeLessThan(20_000_000);
    expect(recordingBitrate(320, 240, 15)).toBe(4_000_000);
    expect(recordingBitrate(3840, 2160, 60)).toBeGreaterThan(50_000_000);
    expect(recordingBitrate(7680, 4320, 60)).toBe(60_000_000);
  });

  it('maps containers to file extensions', () => {
    expect(extensionFor('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extensionFor('video/webm;codecs=vp9')).toBe('webm');
  });
});

describe('camera helpers', () => {
  it('classifies lenses from labels (CAP-2)', () => {
    expect(classifyLens('Back Ultra Wide Camera')).toBe('ultrawide');
    expect(classifyLens('Back Camera')).toBe('wide');
    expect(classifyLens('Back Telephoto Camera')).toBe('telephoto');
    expect(classifyLens('Front Camera')).toBe('front');
    expect(classifyLens('camera2 0, facing back')).toBe('wide');
    expect(classifyLens('Logitech BRIO')).toBe('unknown');
  });

  it('maps browser errors to explainable codes', () => {
    expect(toCameraError({ name: 'NotAllowedError', message: 'denied' }).code).toBe('permission');
    expect(toCameraError({ name: 'NotFoundError', message: '' }).code).toBe('not_found');
    expect(toCameraError({ name: 'NotReadableError', message: '' }).code).toBe('in_use');
    expect(toCameraError({ name: 'OverconstrainedError', message: 'width' }).code).toBe('overconstrained');
    expect(toCameraError(new Error('x')).code).toBe('unknown');
  });
});
