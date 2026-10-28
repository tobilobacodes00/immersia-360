import { describe, expect, it } from 'vitest';
import { slowMotionSchema } from '@immersia/shared';
import {
  REFERENCE_CLIP,
  estimateClipMs,
  formatSeconds,
  msPerMegapixelFrame,
  testSlowMotion,
  type RenderMeasurement,
} from './render-estimate';
import { RENDER_TARGET_LAPTOP_MS, RENDER_TARGET_TABLET_MS, chooseRenderPath, gradeRender, worst } from './grading';

/** A test clip of 4 s at 1080×1920, 30 fps: 120 frames. */
const measured = (renderMs: number, over: Partial<RenderMeasurement> = {}): RenderMeasurement => ({
  renderMs,
  frames: 120,
  width: 1080,
  height: 1920,
  ...over,
});

describe('render speed extrapolation (HLP-1)', () => {
  it('reference clip is 15 s of 1080p at 30 fps', () => {
    expect(REFERENCE_CLIP).toEqual({ seconds: 15, fps: 30, width: 1080, height: 1920 });
  });

  it('scales linearly in frames: 120 frames in 8 s means 450 frames in 30 s', () => {
    expect(estimateClipMs(measured(8000), REFERENCE_CLIP)).toBe(30_000);
  });

  it('scales with pixels: the same time at half the pixels is twice the speed per pixel', () => {
    const half = measured(8000, { width: 540, height: 960 });
    // Four times fewer pixels rendered in the same time: the full-size clip takes four times as long.
    expect(estimateClipMs(half, REFERENCE_CLIP)).toBe(120_000);
  });

  it("knows the cost of the event's own preset, which is not the reference", () => {
    const sixty = { seconds: 15, fps: 60, width: 1080, height: 1920 };
    expect(estimateClipMs(measured(8000), sixty)).toBe(60_000);
  });

  it('refuses a measurement it cannot trust', () => {
    expect(estimateClipMs(measured(0), REFERENCE_CLIP)).toBeNull();
    expect(estimateClipMs(measured(-5), REFERENCE_CLIP)).toBeNull();
    expect(estimateClipMs(measured(8000, { frames: 0 }), REFERENCE_CLIP)).toBeNull();
    expect(estimateClipMs(measured(Number.NaN), REFERENCE_CLIP)).toBeNull();
    expect(msPerMegapixelFrame(measured(8000, { width: 0 }))).toBeNull();
  });

  it('fits the slow-motion segment inside the test take', () => {
    const event = slowMotionSchema.parse({ enabled: true, startS: 2, endS: 6, speed: 0.25 });
    expect(testSlowMotion(event, 4)).toEqual({ enabled: true, startS: 1, endS: 3, speed: 0.25 });
    // Still a valid segment for the schema the renderer relies on.
    expect(slowMotionSchema.safeParse(testSlowMotion(event, 3.2)).success).toBe(true);
  });

  it('formats seconds with one decimal under ten', () => {
    expect(formatSeconds(4321)).toBe(4.3);
    expect(formatSeconds(12_600)).toBe(13);
  });
});

describe('render speed grade (PRD: 45 s laptop, 90 s 2021 iPad)', () => {
  it('passes up to the laptop target, warns up to the iPad target, fails beyond', () => {
    expect(gradeRender({ kind: 'estimate', referenceMs: RENDER_TARGET_LAPTOP_MS })[0]).toMatchObject({
      status: 'pass',
      code: 'fast',
    });
    expect(gradeRender({ kind: 'estimate', referenceMs: RENDER_TARGET_LAPTOP_MS + 1 })[0]).toMatchObject({
      status: 'warn',
      code: 'slower',
    });
    expect(gradeRender({ kind: 'estimate', referenceMs: RENDER_TARGET_TABLET_MS })[0]?.status).toBe('warn');
    expect(gradeRender({ kind: 'estimate', referenceMs: RENDER_TARGET_TABLET_MS + 1 })[0]).toMatchObject({
      status: 'fail',
      code: 'slow',
    });
  });

  it('warns when the event replaces the background and this device cannot', () => {
    const f = gradeRender({ kind: 'estimate', referenceMs: 20_000, backgroundUnavailable: true });
    expect(f.map((x) => [x.status, x.code])).toEqual([
      ['pass', 'fast'],
      ['warn', 'backgroundUnavailable'],
    ]);
    expect(worst(f)).toBe('warn');
  });

  it('reports the estimate in whole seconds', () => {
    expect(gradeRender({ kind: 'estimate', referenceMs: 30_400 })[0]?.params).toEqual({ seconds: 30 });
  });

  it('turns a render error into a fail with its own advice, and unknown errors into "failed"', () => {
    expect(gradeRender({ kind: 'error', code: 'gpu' })[0]).toMatchObject({ status: 'fail', code: 'gpu' });
    expect(gradeRender({ kind: 'error', code: 'undecodable' })[0]?.code).toBe('undecodable');
    expect(gradeRender({ kind: 'error', code: 'something else' })[0]?.code).toBe('failed');
  });

  it('records the render path hint for the device', () => {
    expect(chooseRenderPath({ kind: 'estimate', referenceMs: 20_000 })).toBe('local');
    expect(chooseRenderPath({ kind: 'estimate', referenceMs: RENDER_TARGET_TABLET_MS })).toBe('local');
    expect(chooseRenderPath({ kind: 'estimate', referenceMs: RENDER_TARGET_TABLET_MS + 1 })).toBe('wasm');
    expect(chooseRenderPath({ kind: 'error' })).toBe('server');
  });
});
