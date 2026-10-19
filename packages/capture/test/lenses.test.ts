import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyLens,
  clampZoom,
  groupLenses,
  latestWins,
  listLenses,
  setZoom,
  zoomRange,
  type Lens,
  type LensClass,
} from '../src/lenses';
import type { ConstrainableTrack } from '../src/track';

const c = (facing: LensClass['facing'], kind: LensClass['kind']): LensClass => ({ facing, kind });

describe('classifyLens (CAP-2)', () => {
  // [label, expected]: names as browsers report them, in the languages iOS localises into.
  const cases: [string, LensClass][] = [
    // iOS Safari, English
    ['Front Camera', c('front', 'unknown')],
    ['Back Camera', c('back', 'wide')],
    ['Back Ultra Wide Camera', c('back', 'ultra-wide')],
    ['Back Telephoto Camera', c('back', 'telephoto')],
    ['Back Dual Camera', c('back', 'dual')],
    ['Back Dual Wide Camera', c('back', 'dual')],
    ['Back Triple Camera', c('back', 'triple')],
    ['Desk View Camera', c('external', 'unknown')],
    // iOS Safari, Spanish
    ['Cámara frontal', c('front', 'unknown')],
    ['Cámara trasera', c('back', 'wide')],
    ['Cámara trasera ultra gran angular', c('back', 'ultra-wide')],
    ['Cámara trasera gran angular', c('back', 'wide')],
    ['Cámara trasera con teleobjetivo', c('back', 'telephoto')],
    ['Cámara trasera doble', c('back', 'dual')],
    ['Cámara trasera triple', c('back', 'triple')],
    // iOS Safari, Portuguese (Brazil)
    ['Câmera Frontal', c('front', 'unknown')],
    ['Câmera Traseira', c('back', 'wide')],
    ['Câmera Traseira Ultra-Angular', c('back', 'ultra-wide')],
    ['Câmera Traseira Teleobjetiva', c('back', 'telephoto')],
    ['Câmera Dupla Traseira', c('back', 'dual')],
    ['Câmera Tripla Traseira', c('back', 'triple')],
    // iOS Safari, French
    ['Caméra frontale', c('front', 'unknown')],
    ['Caméra avant', c('front', 'unknown')],
    ['Caméra arrière', c('back', 'wide')],
    ['Caméra arrière ultra grand-angle', c('back', 'ultra-wide')],
    ['Caméra arrière double', c('back', 'dual')],
    ['Caméra arrière téléobjectif', c('back', 'telephoto')],
    // German and Italian, matched by the same word stems
    ['Frontkamera', c('front', 'unknown')],
    ['Rückkamera', c('back', 'wide')],
    ['Fotocamera anteriore', c('front', 'unknown')],
    ['Fotocamera posteriore', c('back', 'wide')],
    ['Fotocamera ultra-grandangolare posteriore', c('back', 'ultra-wide')],
    // Android Chrome and Firefox: a direction, never a lens
    ['camera2 0, facing back', c('back', 'unknown')],
    ['camera2 1, facing front', c('front', 'unknown')],
    ['camera2 2, facing back', c('back', 'unknown')],
    ['Camera 0, Facing back, Orientation 90', c('back', 'unknown')],
    ['Camera 1, Facing front, Orientation 270', c('front', 'unknown')],
    ['0.5x Back Camera', c('back', 'ultra-wide')],
    ['Back Camera 2', c('back', 'unknown')],
    // Laptops, tablets and Continuity Camera
    ['FaceTime HD Camera', c('front', 'unknown')],
    ['FaceTime HD Camera (Built-in)', c('front', 'unknown')],
    ['Cámara FaceTime HD (integrada)', c('front', 'unknown')],
    ['Integrated Camera', c('front', 'unknown')],
    ['Integrated Webcam', c('front', 'unknown')],
    ['Microsoft Camera Front', c('front', 'unknown')],
    ['Microsoft Camera Rear', c('back', 'unknown')],
    ['iPhone Camera', c('external', 'unknown')],
    ["Kevin's iPhone Camera", c('external', 'unknown')],
    // Webcams, capture cards and virtual cameras
    ['Logitech BRIO', c('external', 'unknown')],
    ['HD Pro Webcam C920 (046d:082d)', c('external', 'unknown')],
    ['USB2.0 HD UVC WebCam', c('external', 'unknown')],
    ['USB Video Device', c('external', 'unknown')],
    ['OBS Virtual Camera', c('external', 'unknown')],
    ['Elgato Cam Link 4K', c('external', 'unknown')],
    ['Blackmagic Design UltraStudio', c('external', 'unknown')],
    // Nothing to go on
    ['', c('unknown', 'unknown')],
    ['Camera', c('unknown', 'unknown')],
    ['Wide Camera', c('unknown', 'wide')],
  ];

  it.each(cases)('%s', (label, expected) => {
    expect(classifyLens(label)).toEqual(expected);
  });

  it('is case, accent and punctuation insensitive', () => {
    expect(classifyLens('BACK  ULTRA-WIDE   CAMERA')).toEqual(c('back', 'ultra-wide'));
    expect(classifyLens('camara TRASERA (ultra_gran_angular)')).toEqual(c('back', 'ultra-wide'));
  });

  describe('facing hint (a live track’s facingMode)', () => {
    it('fills in a direction the label lacks', () => {
      expect(classifyLens('camera2 2', 'environment')).toEqual(c('back', 'unknown'));
      expect(classifyLens('', 'user')).toEqual(c('front', 'unknown'));
      expect(classifyLens('', ['environment'])).toEqual(c('back', 'unknown'));
      expect(classifyLens('Camera', 'left')).toEqual(c('external', 'unknown'));
    });

    it('never overrides a direction the label states', () => {
      expect(classifyLens('Back Camera', 'user')).toEqual(c('back', 'wide'));
      expect(classifyLens('Front Camera', 'environment')).toEqual(c('front', 'unknown'));
    });

    it('does not turn a webcam into a front camera because a driver says so', () => {
      expect(classifyLens('Logitech BRIO', 'user')).toEqual(c('external', 'unknown'));
    });

    it('does not call a bare, unlabelled camera a wide lens', () => {
      expect(classifyLens('', 'environment').kind).toBe('unknown');
    });

    it('ignores values that are not a facing mode', () => {
      expect(classifyLens('', 'sideways')).toEqual(c('unknown', 'unknown'));
      expect(classifyLens('', [])).toEqual(c('unknown', 'unknown'));
      expect(classifyLens('', null)).toEqual(c('unknown', 'unknown'));
    });
  });
});

describe('groupLenses', () => {
  const lens = (deviceId: string, label: string, position: number): Lens => ({
    deviceId,
    label,
    position,
    ...classifyLens(label),
  });

  it('groups an iPhone by facing, main lens first', () => {
    const groups = groupLenses([
      lens('f', 'Front Camera', 1),
      lens('t', 'Back Telephoto Camera', 2),
      lens('u', 'Back Ultra Wide Camera', 3),
      lens('w', 'Back Camera', 4),
      lens('tr', 'Back Triple Camera', 5),
      lens('d', 'Back Dual Wide Camera', 6),
    ]);
    expect(groups.map((g) => g.facing)).toEqual(['back', 'front']);
    expect(groups[0]!.lenses.map((l) => l.deviceId)).toEqual(['w', 'u', 't', 'd', 'tr']);
    expect(groups.flatMap((g) => g.lenses).every((l) => l.ordinal === null)).toBe(true);
  });

  it('numbers lenses of the same kind that the label cannot tell apart (Android)', () => {
    const groups = groupLenses([
      lens('a', 'camera2 0, facing back', 1),
      lens('b', 'camera2 1, facing front', 2),
      lens('c', 'camera2 2, facing back', 3),
      lens('d', 'camera2 3, facing back', 4),
    ]);
    const back = groups.find((g) => g.facing === 'back')!;
    expect(back.lenses.map((l) => [l.deviceId, l.ordinal])).toEqual([
      ['a', 1],
      ['c', 2],
      ['d', 3],
    ]);
    expect(groups.find((g) => g.facing === 'front')!.lenses[0]!.ordinal).toBeNull();
  });

  it('keeps the browser order within a kind and numbers only the kinds that repeat', () => {
    const groups = groupLenses([
      lens('x', 'Back Camera', 1),
      lens('y', 'Back Ultra Wide Camera', 2),
      lens('z', 'Back Camera', 3),
    ]);
    expect(groups[0]!.lenses.map((l) => [l.deviceId, l.ordinal])).toEqual([
      ['x', 1],
      ['z', 2],
      ['y', null],
    ]);
  });

  it('orders back, front, external, then anything unidentified, and drops empty groups', () => {
    const groups = groupLenses([
      lens('1', '', 1),
      lens('2', 'Logitech BRIO', 2),
      lens('3', 'Integrated Camera', 3),
      lens('4', 'Rear Camera', 4),
    ]);
    expect(groups.map((g) => g.facing)).toEqual(['back', 'front', 'external', 'unknown']);
    expect(groupLenses([lens('only', 'Logitech BRIO', 1)]).map((g) => g.facing)).toEqual(['external']);
    expect(groupLenses([])).toEqual([]);
  });

  it('does not change the list it is given', () => {
    const input = [lens('b', 'Back Ultra Wide Camera', 1), lens('a', 'Back Camera', 2)];
    const copy = structuredClone(input);
    groupLenses(input);
    expect(input).toEqual(copy);
  });
});

describe('listLenses', () => {
  afterEach(() => vi.unstubAllGlobals());

  const device = (kind: MediaDeviceKind, deviceId: string, label: string) => ({ kind, deviceId, label });
  const withDevices = (devices: unknown) =>
    vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: async () => devices } });

  it('lists the video inputs with their classification and position', async () => {
    withDevices([
      device('audioinput', 'mic', 'Built-in Microphone'),
      device('videoinput', 'front', 'Front Camera'),
      device('videoinput', 'ultra', 'Back Ultra Wide Camera'),
      device('audiooutput', 'spk', 'Speakers'),
    ]);
    expect(await listLenses()).toEqual([
      { deviceId: 'front', label: 'Front Camera', position: 1, facing: 'front', kind: 'unknown' },
      { deviceId: 'ultra', label: 'Back Ultra Wide Camera', position: 2, facing: 'back', kind: 'ultra-wide' },
    ]);
  });

  it('lists nothing before camera permission, when the browser gives out no ids', async () => {
    withDevices([device('videoinput', '', ''), device('videoinput', '', '')]);
    expect(await listLenses()).toEqual([]);
  });

  it('keeps unlabelled cameras that do have ids, unclassified', async () => {
    withDevices([device('videoinput', 'a', ''), device('videoinput', 'b', '')]);
    expect(await listLenses()).toEqual([
      { deviceId: 'a', label: '', position: 1, facing: 'unknown', kind: 'unknown' },
      { deviceId: 'b', label: '', position: 2, facing: 'unknown', kind: 'unknown' },
    ]);
  });

  it('uses the open camera’s facing mode for that camera only', async () => {
    withDevices([device('videoinput', 'a', 'camera2 2'), device('videoinput', 'b', 'camera2 3')]);
    const lenses = await listLenses({ deviceId: 'b', facingMode: 'environment' });
    expect(lenses.map((l) => l.facing)).toEqual(['unknown', 'back']);
  });

  it('is empty, not an error, where the browser cannot list cameras', async () => {
    vi.stubGlobal('navigator', {});
    expect(await listLenses()).toEqual([]);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: async () => {
          throw new Error('blocked');
        },
      },
    });
    expect(await listLenses()).toEqual([]);
  });
});

/** A track whose zoom and torch behave like a phone's: constraints change the settings. */
function fakeTrack(caps: Record<string, unknown> | null, settings: Record<string, unknown> = {}) {
  const state = { ...settings };
  const applyConstraints = vi.fn(async (constraints?: MediaTrackConstraints) => {
    for (const set of constraints?.advanced ?? []) Object.assign(state, set);
  });
  const track: ConstrainableTrack = {
    applyConstraints,
    ...(caps ? { getCapabilities: () => caps as unknown as MediaTrackCapabilities } : {}),
    getSettings: () => state as unknown as MediaTrackSettings,
  };
  return { track, applyConstraints, state };
}

describe('zoom', () => {
  it('reads the range from the track capabilities', () => {
    const { track } = fakeTrack({ zoom: { min: 1, max: 5, step: 0.1 } });
    expect(zoomRange(track)).toEqual({ min: 1, max: 5, step: 0.1 });
  });

  it('invents a step when the browser reports none', () => {
    const { track } = fakeTrack({ zoom: { min: 1, max: 5 } });
    expect(zoomRange(track)).toEqual({ min: 1, max: 5, step: 0.04 });
  });

  it('reports no zoom where there is none', () => {
    expect(zoomRange(fakeTrack({}).track)).toBeNull();
    expect(zoomRange(fakeTrack(null).track)).toBeNull(); // no getCapabilities at all (older Safari)
    expect(zoomRange(fakeTrack({ zoom: { min: 1, max: 1, step: 0.1 } }).track)).toBeNull();
    expect(zoomRange(fakeTrack({ zoom: { min: 0, max: 4, step: 0.1 } }).track)).toBeNull();
    expect(zoomRange(fakeTrack({ zoom: { min: Number.NaN, max: 4 } }).track)).toBeNull();
    expect(zoomRange(fakeTrack({ zoom: 3 }).track)).toBeNull();
    const throwing: ConstrainableTrack = {
      applyConstraints: async () => undefined,
      getCapabilities: () => {
        throw new Error('not allowed');
      },
    };
    expect(zoomRange(throwing)).toBeNull();
  });

  it('clamps to the range and snaps to the step', () => {
    const range = { min: 1, max: 5, step: 0.5 };
    expect(clampZoom(range, 7)).toBe(5);
    expect(clampZoom(range, 0)).toBe(1);
    expect(clampZoom(range, 2.3)).toBe(2.5);
    expect(clampZoom(range, 2.2)).toBe(2);
    expect(clampZoom({ min: 1, max: 4.2, step: 0.5 }, 4.2)).toBe(4.2);
  });

  it('applies the zoom as an advanced constraint and returns what is in effect', async () => {
    const { track, applyConstraints } = fakeTrack({ zoom: { min: 1, max: 5, step: 0.1 } }, { zoom: 1 });
    expect(await setZoom(track, 2.5)).toBe(2.5);
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 2.5 }] });
    // Out of range: clamped before it reaches the camera.
    expect(await setZoom(track, 99)).toBe(5);
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 5 }] });
  });

  it('reports what the camera settled on when it rounds the request', async () => {
    const { track, state } = fakeTrack({ zoom: { min: 1, max: 5, step: 0.1 } });
    track.applyConstraints = async () => {
      state.zoom = 2.4;
    };
    expect(await setZoom(track, 2.5)).toBe(2.4);
  });

  it('never throws: no zoom, or a camera that refuses it, is null', async () => {
    const none = fakeTrack({});
    expect(await setZoom(none.track, 2)).toBeNull();
    expect(none.applyConstraints).not.toHaveBeenCalled();
    const refusing = fakeTrack({ zoom: { min: 1, max: 5, step: 0.1 } });
    refusing.applyConstraints.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'OverconstrainedError' }));
    expect(await setZoom(refusing.track, 2)).toBeNull();
  });
});

describe('latestWins', () => {
  function gated() {
    const started: number[] = [];
    const open: ((result: string) => void)[] = [];
    const run = latestWins(
      (value: number) =>
        new Promise<string>((resolve, reject) => {
          started.push(value);
          open.push((result) => (result === 'boom' ? reject(new Error(result)) : resolve(`${result} ${value}`)));
        }),
    );
    return { run, started, open };
  }

  it('runs one at a time and collapses calls made meanwhile into the newest', async () => {
    const { run, started, open } = gated();
    const first = run(1);
    const second = run(2);
    const third = run(3);
    expect(started).toEqual([1]);
    open[0]!('done');
    expect(await first).toBe('done 1');
    await Promise.resolve();
    expect(started).toEqual([1, 3]); // 2 was superseded
    open[1]!('done');
    // Both collapsed callers learn the outcome of the call that stood for them.
    expect(await Promise.all([second, third])).toEqual(['done 3', 'done 3']);
  });

  it('starts again after it has drained', async () => {
    const { run, started, open } = gated();
    const first = run(1);
    open[0]!('done');
    await first;
    const next = run(2);
    expect(started).toEqual([1, 2]);
    open[1]!('done');
    expect(await next).toBe('done 2');
  });

  it('rejects the callers of a failed run and keeps working', async () => {
    const { run, started, open } = gated();
    const failing = run(1);
    const failed = expect(failing).rejects.toThrow('boom');
    open[0]!('boom');
    await failed;
    const next = run(2);
    expect(started).toEqual([1, 2]);
    open[1]!('done');
    expect(await next).toBe('done 2');
  });
});
