import { describe, expect, it } from 'vitest';
import {
  SEGMENTER_ASSETS,
  SegmenterError,
  frameSize,
  inferenceSize,
  nextTimestamp,
  personProbability,
} from '../src/segment';

describe('segmenter input size', () => {
  it('scales a frame to a long side of at most 256 and keeps its aspect', () => {
    expect(inferenceSize(1920, 1080)).toEqual({ width: 256, height: 144 });
    expect(inferenceSize(1080, 1920)).toEqual({ width: 144, height: 256 });
    expect(inferenceSize(1000, 1000)).toEqual({ width: 256, height: 256 });
  });

  it('never upscales, and never collapses to zero', () => {
    expect(inferenceSize(200, 100)).toEqual({ width: 200, height: 100 });
    expect(inferenceSize(5000, 3)).toEqual({ width: 256, height: 1 });
    expect(inferenceSize(0, 0)).toEqual({ width: 1, height: 1 });
  });

  it('honours another long side', () => {
    expect(inferenceSize(1920, 1080, 512)).toEqual({ width: 512, height: 288 });
  });

  it('reads the size of every kind of frame the browser hands over', () => {
    expect(frameSize({ videoWidth: 1280, videoHeight: 720 } as unknown as TexImageSource)).toEqual({
      width: 1280,
      height: 720,
    });
    expect(frameSize({ displayWidth: 640, displayHeight: 360 } as unknown as TexImageSource)).toEqual({
      width: 640,
      height: 360,
    });
    expect(frameSize({ naturalWidth: 300, naturalHeight: 200 } as unknown as TexImageSource)).toEqual({
      width: 300,
      height: 200,
    });
    expect(frameSize({ width: 64, height: 48 } as unknown as TexImageSource)).toEqual({ width: 64, height: 48 });
    expect(frameSize({} as unknown as TexImageSource)).toEqual({ width: 0, height: 0 });
  });
});

describe('video-mode timestamps', () => {
  it('keeps rising: a repeat or a step back is nudged to one past the last', () => {
    expect(nextTimestamp(100, -1)).toBe(100);
    expect(nextTimestamp(100, 100)).toBe(101);
    expect(nextTimestamp(50, 100)).toBe(101);
  });

  it('works in whole milliseconds and survives a bad clock', () => {
    expect(nextTimestamp(33.4, 0)).toBe(33);
    expect(nextTimestamp(Number.NaN, 7)).toBe(8);
    expect(nextTimestamp(Infinity, 7)).toBe(8);
  });
});

describe('the person mask from whatever the model emits', () => {
  it('the selfie model has one class and its mask is the person', () => {
    const out = personProbability(['selfie'], [[0, 0.25, 1]]);
    expect(Array.from(out)).toEqual([0, 0.25, 1]);
  });

  it('with no labels at all a single mask is still the person', () => {
    expect(Array.from(personProbability([], [[0.5]]))).toEqual([0.5]);
  });

  it('a model with a background class gives the person as everything that is not background', () => {
    // Two classes, background first (the usual order) and last.
    expect(
      Array.from(
        personProbability(
          ['background', 'person'],
          [
            [0.9, 0.1],
            [0.1, 0.9],
          ],
        ),
      ),
    ).toEqual([expect.closeTo(0.1), expect.closeTo(0.9)]);
    expect(
      Array.from(
        personProbability(
          ['person', 'background'],
          [
            [0.1, 0.9],
            [0.9, 0.1],
          ],
        ),
      ),
    ).toEqual([expect.closeTo(0.1), expect.closeTo(0.9)]);
    // Several classes: hair, skin and clothes together are the person.
    const out = personProbability(['background', 'hair', 'skin', 'clothes'], [[0.2], [0.3], [0.1], [0.4]]);
    expect(out[0]).toBeCloseTo(0.8);
  });

  it('is always a copy, clamped to 0..1', () => {
    const source = new Float32Array([-0.2, 0.5, 1.3]);
    const out = personProbability(['selfie'], [source]);
    expect(out).not.toBe(source);
    expect(Array.from(out)).toEqual([0, 0.5, 1]);
    source[1] = 0.9;
    expect(out[1]).toBe(0.5);
  });

  it('refuses an empty result', () => {
    expect(() => personProbability(['selfie'], [])).toThrow(SegmenterError);
  });
});

describe('where the build puts the model', () => {
  it('serves it, and the wasm runtime, from our own origin', () => {
    expect(SEGMENTER_ASSETS.wasmBase.startsWith('/')).toBe(true);
    expect(SEGMENTER_ASSETS.modelUrl).toBe(`${SEGMENTER_ASSETS.wasmBase}/selfie_segmenter.tflite`);
    expect(SEGMENTER_ASSETS.modelUrl).not.toMatch(/^[a-z]+:/i);
  });
});
