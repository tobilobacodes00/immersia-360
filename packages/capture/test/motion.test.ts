import { describe, expect, it, vi } from 'vitest';
import { GRID_H, GRID_W, MotionTrigger, analyzeFrames, createMotionDetector } from '../src/motion';

/** A textured scene (vertical stripes of varying brightness) shifted right by `dx` columns. */
function scene(dx: number, brightness = 0): Uint8Array {
  const f = new Uint8Array(GRID_W * GRID_H);
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      const sx = x - dx;
      const v = 60 + 120 * (Math.sin(sx * 0.9) > 0 ? 1 : 0) + ((sx * 37) % 40);
      f[y * GRID_W + x] = Math.max(0, Math.min(255, v + brightness));
    }
  return f;
}

/** A dark blob growing in the centre: approach towards the camera, no sideways motion. */
function blob(radius: number): Uint8Array {
  const f = new Uint8Array(GRID_W * GRID_H).fill(200);
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++)
      if ((x - GRID_W / 2) ** 2 + (y - GRID_H / 2) ** 2 < radius ** 2) f[y * GRID_W + x] = 30;
  return f;
}

describe('analyzeFrames', () => {
  it('sees no motion between identical frames', () => {
    const s = analyzeFrames(scene(0), scene(0));
    expect(s.energy).toBe(0);
    expect(s.confidence).toBe(0);
    expect(s.duplicate).toBe(true);
    expect(analyzeFrames(scene(0), scene(0, 1)).duplicate).toBe(false); // sensor noise: a new frame
  });

  it('measures a horizontal pan and its direction', () => {
    const right = analyzeFrames(scene(0), scene(3));
    expect(right.energy).toBeGreaterThan(0.2);
    expect(right.shift).toBe(3);
    expect(right.confidence).toBeGreaterThan(0.5);
    expect(analyzeFrames(scene(0), scene(-2)).shift).toBe(-2);
  });

  it('a global brightness change is energy without a confident sideways shift', () => {
    const s = analyzeFrames(scene(0), scene(0, 40));
    expect(s.energy).toBeGreaterThan(0.5);
    expect(s.confidence).toBeLessThan(0.15);
  });

  it('an approaching person has little sideways shift', () => {
    const s = analyzeFrames(blob(6), blob(10));
    expect(s.energy).toBeGreaterThan(0.02);
    expect(Math.abs(s.shift) === 0 || s.confidence < 0.15).toBe(true);
  });
});

describe('MotionTrigger', () => {
  it('fires after sustained sideways motion above the threshold', () => {
    const trig = new MotionTrigger({ threshold: 0.1, sustain: 3 });
    let fired = false;
    for (let i = 0; i < 3; i++) fired = trig.update(analyzeFrames(scene(i * 2), scene(i * 2 + 2)));
    expect(fired).toBe(true);
  });

  it('does not fire on a brief bump', () => {
    const trig = new MotionTrigger({ threshold: 0.1, sustain: 3 });
    expect(trig.update(analyzeFrames(scene(0), scene(2)))).toBe(false);
    // A still frame (a real one: sensor noise, so not a repeat) breaks the run.
    expect(trig.update(analyzeFrames(scene(2), scene(2, 1)))).toBe(false);
    expect(trig.update(analyzeFrames(scene(2, 1), scene(4, 1)))).toBe(false);
  });

  it('skips repeated frames (no new camera frame) without breaking a run', () => {
    const trig = new MotionTrigger({ threshold: 0.1, sustain: 3 });
    const dup = () => trig.update(analyzeFrames(scene(4), scene(4)));
    expect(trig.update(analyzeFrames(scene(0), scene(2)))).toBe(false);
    expect(dup()).toBe(false);
    expect(trig.update(analyzeFrames(scene(2), scene(4)))).toBe(false);
    expect(dup()).toBe(false);
    expect(trig.update(analyzeFrames(scene(4), scene(6)))).toBe(true);
  });

  it('a feed frozen for long ends the run', () => {
    const trig = new MotionTrigger({ threshold: 0.1, sustain: 3 });
    trig.update(analyzeFrames(scene(0), scene(2)));
    trig.update(analyzeFrames(scene(2), scene(4)));
    for (let i = 0; i < 6; i++) trig.update(analyzeFrames(scene(4), scene(4)));
    expect(trig.update(analyzeFrames(scene(4), scene(6)))).toBe(false);
  });

  it('does not fire when the direction keeps flipping', () => {
    const trig = new MotionTrigger({ threshold: 0.1, sustain: 3 });
    const results = [
      trig.update(analyzeFrames(scene(0), scene(2))),
      trig.update(analyzeFrames(scene(2), scene(0))),
      trig.update(analyzeFrames(scene(0), scene(2))),
    ];
    expect(results).toEqual([false, false, false]);
  });

  it('respects the threshold', () => {
    const trig = new MotionTrigger({ threshold: 0.99, sustain: 1 });
    expect(trig.update(analyzeFrames(scene(0), scene(2)))).toBe(false);
  });

  it('ignores lighting changes', () => {
    const trig = new MotionTrigger({ threshold: 0.05, sustain: 2 });
    expect(trig.update(analyzeFrames(scene(0), scene(0, 40)))).toBe(false);
    expect(trig.update(analyzeFrames(scene(0, 40), scene(0, 80)))).toBe(false);
  });
});

describe('createMotionDetector (one decision for a video element and the native camera)', () => {
  it('triggers when a spin has been seen for a few frames, then rests for the cooldown', () => {
    let t = 0;
    const onTrigger = vi.fn();
    const detect = createMotionDetector({ threshold: 0.1, cooldownMs: 1000, now: () => t, onTrigger });
    let step = 0;
    const frame = () => {
      t += 100;
      detect(scene(step++ * 2));
    };

    // The first frame has nothing to compare with; three qualifying comparisons follow before it fires.
    for (let i = 0; i < 3; i++) frame();
    expect(onTrigger).not.toHaveBeenCalled();
    frame();
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // Still spinning through the cooldown: one start is one trigger.
    while (t < 1400) frame();
    expect(onTrigger).toHaveBeenCalledTimes(1);
    // After it, a new run of sideways motion starts it again.
    for (let i = 0; i < 3; i++) frame();
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a still platform or a change of light', () => {
    const onTrigger = vi.fn();
    const detect = createMotionDetector({ threshold: 0.05, cooldownMs: 0, now: () => 1e9, onTrigger });
    for (let i = 0; i < 20; i++) detect(scene(0, i % 2 ? 40 : 0));
    expect(onTrigger).not.toHaveBeenCalled();
  });
});
