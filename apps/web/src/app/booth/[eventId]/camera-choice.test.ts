import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAMERA_CHOICE_KEY,
  FILL_OFF,
  applyChoice,
  fillLightOf,
  needsReopen,
  parseCameraChoice,
  readCameraChoice,
  reconcileChoice,
  saveCameraChoice,
  switchCamera,
  type CameraChoice,
} from './camera-choice';

const DEFAULT: CameraChoice = { source: 'camera', deviceId: null, mirror: false };
const choice = (over: Partial<CameraChoice> = {}): CameraChoice => ({ ...DEFAULT, ...over });

describe('parseCameraChoice: values saved by earlier versions', () => {
  it('keeps a v1 value exactly as it was, adding nothing', () => {
    expect(parseCameraChoice(JSON.stringify({ source: 'camera', deviceId: 'abc', mirror: true }))).toStrictEqual({
      source: 'camera',
      deviceId: 'abc',
      mirror: true,
    });
    // What the E2E helpers have always seeded for browsers with no camera.
    expect(parseCameraChoice(JSON.stringify({ source: 'simulator', deviceId: null, mirror: false }))).toStrictEqual({
      source: 'simulator',
      deviceId: null,
      mirror: false,
    });
  });

  it('fills the old gaps the way the old reader did', () => {
    expect(parseCameraChoice('{"source":"camera"}')).toStrictEqual(DEFAULT);
    expect(parseCameraChoice('{"source":"camera","deviceId":"","mirror":"yes"}')).toStrictEqual(DEFAULT);
    expect(parseCameraChoice('{"source":"camera","deviceId":42}')).toStrictEqual(DEFAULT);
  });

  it.each<[string, string | null]>([
    ['nothing saved', null],
    ['not JSON', '{oops'],
    ['JSON null', 'null'],
    ['a number', '7'],
    ['a string', '"camera"'],
    ['an array', '["camera"]'],
    ['an unknown source', '{"source":"phone","deviceId":"x"}'],
    ['no source', '{"deviceId":"x","mirror":true}'],
  ])('falls back to the default camera for %s', (_name, raw) => {
    expect(parseCameraChoice(raw)).toStrictEqual(DEFAULT);
  });
});

describe('parseCameraChoice: zoom, torch and fill light', () => {
  it('round-trips a full choice', () => {
    const full = choice({
      deviceId: 'back-2',
      mirror: true,
      zoom: 2.5,
      torch: true,
      fillLight: { level: 'bright', tint: 'warm' },
    });
    expect(parseCameraChoice(JSON.stringify(full))).toStrictEqual(full);
  });

  it('drops a zoom that cannot be one', () => {
    for (const zoom of [0, -1, '2', null, true, {}]) {
      expect(parseCameraChoice(JSON.stringify({ ...DEFAULT, zoom })), String(zoom)).toStrictEqual(DEFAULT);
    }
  });

  it('keeps a torch only when it is on', () => {
    expect(parseCameraChoice(JSON.stringify({ ...DEFAULT, torch: true }))).toStrictEqual(choice({ torch: true }));
    for (const torch of [false, 'yes', 1, null]) {
      expect(parseCameraChoice(JSON.stringify({ ...DEFAULT, torch })), String(torch)).toStrictEqual(DEFAULT);
    }
  });

  it('repairs a fill light field by field and drops one that is not an object', () => {
    const parse = (fillLight: unknown) => parseCameraChoice(JSON.stringify({ ...DEFAULT, fillLight })).fillLight;
    expect(parse({ level: 'soft' })).toEqual({ level: 'soft', tint: 'neutral' });
    expect(parse({ level: 'blinding', tint: 'warm' })).toEqual({ level: 'off', tint: 'warm' });
    expect(parse({ level: 'bright', tint: 'green' })).toEqual({ level: 'bright', tint: 'neutral' });
    expect(parse({})).toEqual({ level: 'off', tint: 'neutral' });
    expect(parse('bright')).toBeUndefined();
    expect(parse(null)).toBeUndefined();
    expect(parse(3)).toBeUndefined();
  });

  it('ignores keys it does not know', () => {
    expect(parseCameraChoice(JSON.stringify({ ...DEFAULT, flash: 'always', version: 9 }))).toStrictEqual(DEFAULT);
  });
});

describe('storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  function storage() {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
    return data;
  }

  it('saves under the same key as before and reads it back', () => {
    const data = storage();
    const saved = choice({ deviceId: 'x', zoom: 3, torch: true, fillLight: { level: 'soft', tint: 'warm' } });
    saveCameraChoice(saved);
    expect(CAMERA_CHOICE_KEY).toBe('immersia.booth.camera.v1');
    expect(JSON.parse(data.get('immersia.booth.camera.v1')!)).toEqual(saved);
    expect(readCameraChoice()).toStrictEqual(saved);
  });

  it('reads a value an older build saved', () => {
    const data = storage();
    data.set(CAMERA_CHOICE_KEY, '{"source":"camera","deviceId":"old","mirror":true}');
    expect(readCameraChoice()).toStrictEqual({ source: 'camera', deviceId: 'old', mirror: true });
  });

  it('works without storage (private windows, blocked site data)', () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
    expect(readCameraChoice()).toStrictEqual(DEFAULT);
    expect(() => saveCameraChoice(DEFAULT)).not.toThrow();
  });
});

describe('needsReopen', () => {
  it('reopens for a different camera only', () => {
    const base = choice({ deviceId: 'a' });
    expect(needsReopen(base, choice({ deviceId: 'b' }))).toBe(true);
    expect(needsReopen(base, choice({ deviceId: null }))).toBe(true);
    expect(needsReopen(base, { ...base, source: 'simulator' })).toBe(true);
  });

  it('leaves the camera alone for zoom, torch, mirror and fill light', () => {
    const base = choice({ deviceId: 'a' });
    expect(needsReopen(base, { ...base, zoom: 2 })).toBe(false);
    expect(needsReopen(base, { ...base, torch: true })).toBe(false);
    expect(needsReopen(base, { ...base, mirror: true })).toBe(false);
    expect(needsReopen(base, { ...base, fillLight: { level: 'bright', tint: 'warm' } })).toBe(false);
  });
});

describe('applyChoice and switchCamera', () => {
  it('a lens change starts zoom over and keeps the rest', () => {
    const before = choice({
      deviceId: 'a',
      zoom: 2,
      torch: true,
      mirror: true,
      fillLight: { level: 'soft', tint: 'warm' },
    });
    const after = applyChoice(before, switchCamera({ source: 'camera', deviceId: 'b' }));
    expect(after).toStrictEqual({
      source: 'camera',
      deviceId: 'b',
      mirror: true,
      torch: true,
      fillLight: { level: 'soft', tint: 'warm' },
    });
    expect('zoom' in after).toBe(false);
    expect(needsReopen(before, after)).toBe(true);
  });

  it('clears a torch switched off and a setting patched to undefined', () => {
    const before = choice({ torch: true, zoom: 2, fillLight: { level: 'bright', tint: 'neutral' } });
    expect(applyChoice(before, { torch: false })).toStrictEqual(
      choice({ zoom: 2, fillLight: { level: 'bright', tint: 'neutral' } }),
    );
    expect(applyChoice(before, { zoom: undefined, fillLight: undefined })).toStrictEqual(choice({ torch: true }));
  });

  it('does not change what it is given', () => {
    const before = choice({ zoom: 2 });
    applyChoice(before, { zoom: undefined, mirror: true });
    expect(before).toStrictEqual(choice({ zoom: 2 }));
  });
});

describe('fillLightOf', () => {
  it('is off until chosen', () => {
    expect(fillLightOf(DEFAULT)).toBe(FILL_OFF);
    expect(fillLightOf(choice({ fillLight: { level: 'soft', tint: 'warm' } }))).toEqual({
      level: 'soft',
      tint: 'warm',
    });
  });
});

describe('reconcileChoice: what the camera really did on opening', () => {
  const cam = (over: Partial<Parameters<typeof reconcileChoice>[1]> = {}) => ({
    torchSupported: true,
    zoomSupported: true,
    applied: { zoom: 1, torch: false },
    ...over,
  });

  it('returns the same choice when the camera did as asked', () => {
    const c = choice({ zoom: 2, torch: true });
    expect(reconcileChoice(c, cam({ applied: { zoom: 2, torch: true } }))).toBe(c);
    expect(reconcileChoice(DEFAULT, cam())).toBe(DEFAULT);
  });

  it('tolerates rounding in the zoom the camera reports', () => {
    const c = choice({ zoom: 2.5 });
    expect(reconcileChoice(c, cam({ applied: { zoom: 2.503, torch: false } }))).toBe(c);
  });

  it('drops a torch the camera supports but would not switch on', () => {
    const c = choice({ torch: true, zoom: 2 });
    expect(reconcileChoice(c, cam({ applied: { zoom: 2, torch: false } }))).toStrictEqual(choice({ zoom: 2 }));
  });

  it('keeps a torch for later when this camera has none (a front camera)', () => {
    const c = choice({ torch: true });
    expect(reconcileChoice(c, cam({ torchSupported: false }))).toBe(c);
  });

  it('shows the zoom the camera settled on when it clamped the request', () => {
    expect(reconcileChoice(choice({ zoom: 9 }), cam({ applied: { zoom: 4, torch: false } }))).toStrictEqual(
      choice({ zoom: 4 }),
    );
  });

  it('drops a zoom the camera supports but did not take, and keeps one for a camera with no zoom', () => {
    expect(reconcileChoice(choice({ zoom: 2 }), cam({ applied: { zoom: null, torch: false } }))).toStrictEqual(DEFAULT);
    const c = choice({ zoom: 2 });
    expect(reconcileChoice(c, cam({ zoomSupported: false, applied: { zoom: null, torch: false } }))).toBe(c);
  });
});
