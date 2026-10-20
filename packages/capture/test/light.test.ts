import { describe, expect, it, vi } from 'vitest';
import { setTorch, torchSupported } from '../src/light';
import type { ConstrainableTrack } from '../src/track';

function track(opts: {
  caps?: Record<string, unknown> | null;
  settings?: Record<string, unknown>;
  apply?: (c?: MediaTrackConstraints) => Promise<void>;
}) {
  const applyConstraints = vi.fn(opts.apply ?? (async () => undefined));
  const t: ConstrainableTrack = {
    applyConstraints,
    ...(opts.caps === null ? {} : { getCapabilities: () => (opts.caps ?? {}) as unknown as MediaTrackCapabilities }),
    getSettings: () => (opts.settings ?? {}) as unknown as MediaTrackSettings,
  };
  return { t, applyConstraints };
}

const named = (name: string) => Object.assign(new Error(name), { name });

describe('torchSupported (CAP-6)', () => {
  it('follows the track capabilities', () => {
    expect(torchSupported(track({ caps: { torch: true } }).t)).toBe(true);
    expect(torchSupported(track({ caps: { torch: false } }).t)).toBe(false);
    expect(torchSupported(track({ caps: {} }).t)).toBe(false);
  });

  it('is false where the browser has no capabilities API or it throws', () => {
    expect(torchSupported(track({ caps: null }).t)).toBe(false);
    const throwing: ConstrainableTrack = {
      applyConstraints: async () => undefined,
      getCapabilities: () => {
        throw named('InvalidStateError');
      },
    };
    expect(torchSupported(throwing)).toBe(false);
  });
});

describe('setTorch', () => {
  it('applies the torch as an advanced constraint', async () => {
    const { t, applyConstraints } = track({ caps: { torch: true } });
    expect(await setTorch(t, true)).toEqual({ ok: true, on: true });
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    expect(await setTorch(t, false)).toEqual({ ok: true, on: false });
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
  });

  it('accepts a track that does not report its torch setting', async () => {
    const { t } = track({ caps: { torch: true }, settings: { width: 1280 } });
    expect(await setTorch(t, true)).toEqual({ ok: true, on: true });
  });

  it('confirms against the track settings where it reports them', async () => {
    const on = track({ caps: { torch: true }, settings: { torch: true } });
    expect(await setTorch(on.t, true)).toEqual({ ok: true, on: true });
  });

  it('reports unsupported without touching the camera when there is no torch', async () => {
    const { t, applyConstraints } = track({ caps: {} });
    expect(await setTorch(t, true)).toEqual({ ok: false, reason: 'unsupported' });
    expect(applyConstraints).not.toHaveBeenCalled();
  });

  it('reports unsupported when the browser rejects the constraint (iOS)', async () => {
    for (const name of ['OverconstrainedError', 'NotSupportedError', 'TypeError']) {
      const { t } = track({
        caps: { torch: true },
        apply: async () => {
          throw named(name);
        },
      });
      expect(await setTorch(t, true), name).toEqual({ ok: false, reason: 'unsupported' });
    }
  });

  it('reports unsupported when the browser accepts the constraint but the light stays as it was', async () => {
    const { t } = track({ caps: { torch: true }, settings: { torch: false } });
    expect(await setTorch(t, true)).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('reports a failure that is not about support, and never throws', async () => {
    const { t } = track({
      caps: { torch: true },
      apply: async () => {
        throw named('NotReadableError');
      },
    });
    expect(await setTorch(t, true)).toEqual({ ok: false, reason: 'failed' });
    const odd = track({
      caps: { torch: true },
      apply: () => Promise.reject(undefined),
    });
    expect(await setTorch(odd.t, true)).toEqual({ ok: false, reason: 'failed' });
  });
});
