import { describe, expect, it } from 'vitest';
import { analyticsEventSchema } from '@immersia/shared';
import { renderCompleted, renderFailed } from './render-events';

const NOW = 1_800_000_000_000;
const take = { trigger: 'tap', capturedAt: NOW - 70_000, durationMs: 8_000 };
const video = {
  resolution: '1080p' as const,
  fps: 60 as const,
  quality: 'balanced' as const,
  effects: [{ id: 'confetti', intensity: 1 }],
};

describe('render analytics events', () => {
  it('a finished render says which rung did it, how long it took, and how long the guest waited', () => {
    const e = renderCompleted({ take, video, path: 'wasm', renderMs: 52_000, now: NOW });
    expect(e).toEqual({
      name: 'render_completed',
      render_ms: 52_000,
      path: 'wasm',
      preset: '1080p-60fps-balanced',
      effects_count: 1,
      mode: 'video360',
      seconds_since_take: 62, // 70 s since the take began, minus its 8 s
    });
  });

  it('is always valid for the catalogue, whatever rung it came from', () => {
    for (const path of ['local', 'wasm', 'server'] as const)
      expect(
        analyticsEventSchema.safeParse(renderCompleted({ take, video, path, renderMs: 1000, now: NOW })).success,
      ).toBe(true);
  });

  it('keeps every number in its bounds', () => {
    const e = renderCompleted({
      take: { ...take, capturedAt: NOW + 10_000 },
      video: { ...video, effects: Array.from({ length: 40 }, () => ({ id: 'a', intensity: 1 })) },
      path: 'local',
      renderMs: 9_999_999_999,
      now: NOW,
    });
    expect(e.render_ms).toBe(3_600_000);
    expect(e.effects_count).toBe(32);
    expect(e.seconds_since_take).toBe(0);
    expect(renderCompleted({ take, video, path: 'local', renderMs: -5, now: NOW }).render_ms).toBe(0);
    expect(analyticsEventSchema.safeParse(e).success).toBe(true);
  });

  it('has no capture-to-QR time for an imported file', () => {
    const e = renderCompleted({ take: { ...take, trigger: 'import' }, video, path: 'local', renderMs: 1000, now: NOW });
    expect('seconds_since_take' in e).toBe(false);
  });

  it('a failed render carries its rung and a machine code', () => {
    const e = renderFailed({ code: 'encoder_stall', path: 'wasm', browser: 'Safari' })!;
    expect(e).toEqual({ name: 'render_failed', error_code: 'encoder_stall', path: 'wasm', browser: 'Safari' });
    expect(analyticsEventSchema.safeParse(e).success).toBe(true);
    for (const code of ['server_limit', 'server_failed', 'unsupported_encoder'])
      expect(analyticsEventSchema.safeParse(renderFailed({ code, path: 'server', browser: 'Chrome' })).success).toBe(
        true,
      );
  });

  it('a cancel is the operator’s choice, not a failure', () => {
    expect(renderFailed({ code: 'cancelled', path: 'local', browser: 'Chrome' })).toBeNull();
  });
});
