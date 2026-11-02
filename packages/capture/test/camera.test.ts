import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCamera } from '../src/camera';

/** A phone's back camera: zoom and torch exist, and constraints change the settings. */
function phoneCamera(caps: Record<string, unknown>, label = 'Back Camera') {
  const state: Record<string, unknown> = { width: 1280, height: 720, frameRate: 30, deviceId: 'back-1', zoom: 1 };
  const applyConstraints = vi.fn(async (constraints?: MediaTrackConstraints) => {
    for (const set of constraints?.advanced ?? []) Object.assign(state, set);
  });
  const stop = vi.fn();
  const track = {
    label,
    getCapabilities: () => caps,
    getSettings: () => state,
    applyConstraints,
    stop,
  };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  return { applyConstraints, getUserMedia, stop };
}

afterEach(() => vi.unstubAllGlobals());

describe('openCamera restores zoom and torch (CAP-2, CAP-6)', () => {
  const caps = { zoom: { min: 1, max: 4, step: 0.1 }, torch: true, facingMode: ['environment'] };

  it('re-applies the saved zoom and torch once the camera is open', async () => {
    const { applyConstraints } = phoneCamera(caps);
    const cam = await openCamera({
      resolution: '720p',
      frameRate: 30,
      deviceId: 'back-1',
      restore: { zoom: 2.5, torch: true },
    });
    expect(applyConstraints.mock.calls.map(([c]) => c)).toEqual([
      { advanced: [{ zoom: 2.5 }] },
      { advanced: [{ torch: true }] },
    ]);
    expect(cam.applied).toEqual({ zoom: 2.5, torch: true });
    expect(cam.torch.supported).toBe(true);
    expect(cam.zoom.range).toEqual({ min: 1, max: 4, step: 0.1 });
    expect(cam.lens).toEqual({ facing: 'back', kind: 'wide' });
    expect(cam.settings.deviceId).toBe('back-1');
  });

  it('puts nothing back when nothing was saved', async () => {
    const { applyConstraints } = phoneCamera(caps);
    const cam = await openCamera({ resolution: '720p', frameRate: 30 });
    expect(applyConstraints).not.toHaveBeenCalled();
    expect(cam.applied).toEqual({ zoom: 1, torch: false });
  });

  it('ignores a saved zoom and torch the camera cannot do', async () => {
    const { applyConstraints } = phoneCamera({}, 'Front Camera');
    const cam = await openCamera({ resolution: '720p', frameRate: 30, restore: { zoom: 3, torch: true } });
    expect(applyConstraints).not.toHaveBeenCalled();
    expect(cam.applied).toEqual({ zoom: 1, torch: false });
    expect(cam.torch.supported).toBe(false);
    expect(cam.zoom.range).toBeNull();
    expect(cam.lens.facing).toBe('front');
  });

  it('opens anyway when the camera refuses the saved torch', async () => {
    const { applyConstraints } = phoneCamera(caps);
    applyConstraints.mockImplementationOnce(async () => undefined); // zoom
    applyConstraints.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotReadableError' })); // torch
    const cam = await openCamera({ resolution: '720p', frameRate: 30, restore: { zoom: 2, torch: true } });
    expect(cam.applied.torch).toBe(false);
    expect(cam.torch.supported).toBe(true);
  });

  it('collapses a burst of zoom changes into the newest', async () => {
    const { applyConstraints } = phoneCamera(caps);
    const cam = await openCamera({ resolution: '720p', frameRate: 30 });
    const results = await Promise.all([cam.zoom.set(1.5), cam.zoom.set(2), cam.zoom.set(3)]);
    // The first goes out at once; 2 was superseded by 3 before the camera was free.
    expect(applyConstraints.mock.calls.map(([c]) => c)).toEqual([
      { advanced: [{ zoom: 1.5 }] },
      { advanced: [{ zoom: 3 }] },
    ]);
    expect(results).toEqual([1.5, 3, 3]);
  });

  it('stops every track on stop()', async () => {
    const { stop } = phoneCamera(caps);
    const cam = await openCamera({ resolution: '720p', frameRate: 30 });
    cam.stop();
    expect(stop).toHaveBeenCalledOnce();
  });
});
