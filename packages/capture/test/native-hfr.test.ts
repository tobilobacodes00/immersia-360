import { describe, expect, it, vi } from 'vitest';
import type {
  HighSpeedCapabilities,
  HighSpeedLens,
  HighSpeedPlugin,
  PreviewInfo,
  RecordingResult as NativeRecording,
  StartPreviewOptions,
} from '@immersia/capacitor-high-speed';
import { CameraError } from '../src/camera';
import { GRID_H, GRID_W } from '../src/motion';
import {
  NATIVE_SLICE_BYTES,
  NativeTakeRecorder,
  decodeLuma,
  defaultNativeLens,
  detectNativeHfr,
  hfrFpsOptions,
  nativeFileUrl,
  openNativeHfrCamera,
  pickHfrFormat,
  pickHfrFps,
  planNativeHfr,
  readNativeFile,
  toNativeHfrError,
  type NativeHfrEvent,
} from '../src/native-hfr';

const lens = (
  id: string,
  facing: HighSpeedLens['facing'],
  kind: HighSpeedLens['kind'],
  formats: [number, number, number][],
): HighSpeedLens => ({
  id,
  label: `Lens ${id}`,
  facing,
  kind,
  formats: formats.map(([width, height, fps]) => ({ width, height, fps })),
});

/** A recent iPhone: the main lens does 240 at 1080p and 120 at 4K, the ultra-wide 240 at 1080p, the selfie 120. */
const BACK = lens('back-wide', 'back', 'wide', [
  [1280, 720, 120],
  [1280, 720, 240],
  [1920, 1080, 120],
  [1920, 1080, 240],
  [3840, 2160, 120],
]);
const ULTRA = lens('back-ultra', 'back', 'ultra-wide', [[1920, 1080, 240]]);
const FRONT = lens('front', 'front', 'wide', [[1280, 720, 120]]);
const CAPS: HighSpeedCapabilities = {
  available: true,
  platform: 'ios',
  mime: 'video/quicktime',
  codecs: ['h264', 'hevc'],
  motionSampling: true,
  lenses: [FRONT, ULTRA, BACK],
};

describe('detectNativeHfr (source detection)', () => {
  const native = { isNativePlatform: () => true, isPluginAvailable: (name: string) => name === 'HighSpeed' };

  it('is false in a browser: there is no Capacitor global to look at', () => {
    expect(detectNativeHfr({})).toBe(false);
    expect(detectNativeHfr({ Capacitor: undefined })).toBe(false);
  });

  it('is false in a native shell without the plugin, and in the web platform of Capacitor', () => {
    expect(detectNativeHfr({ Capacitor: { ...native, isPluginAvailable: () => false } })).toBe(false);
    expect(detectNativeHfr({ Capacitor: { ...native, isNativePlatform: () => false } })).toBe(false);
    expect(detectNativeHfr({ Capacitor: { isNativePlatform: () => true } })).toBe(false);
  });

  it('is true inside the companion, which has the plugin', () => {
    expect(detectNativeHfr({ Capacitor: native })).toBe(true);
  });

  it('never throws, whatever the shell does', () => {
    const throwing = {
      isNativePlatform: () => {
        throw new Error('boom');
      },
    };
    expect(detectNativeHfr({ Capacitor: throwing })).toBe(false);
  });

  it('turns a native file path into the URL Capacitor serves it at', () => {
    const convertFileSrc = (p: string) => p.replace('file://', 'https://booth.example.com/_capacitor_file_');
    expect(nativeFileUrl('file:///var/x/1.hfr', { Capacitor: { convertFileSrc } })).toBe(
      'https://booth.example.com/_capacitor_file_/var/x/1.hfr',
    );
    expect(() => nativeFileUrl('file:///x', {})).toThrow(CameraError);
  });
});

describe('capabilities to choice mapping', () => {
  it("lists a lens's frame rates, highest first", () => {
    expect(hfrFpsOptions(BACK)).toEqual([240, 120]);
    expect(hfrFpsOptions(FRONT)).toEqual([120]);
    expect(hfrFpsOptions(undefined)).toEqual([]);
  });

  it('defaults to the main back lens, then any back lens, then any lens', () => {
    expect(defaultNativeLens(CAPS.lenses)?.id).toBe('back-wide');
    expect(defaultNativeLens([FRONT, ULTRA])?.id).toBe('back-ultra');
    expect(defaultNativeLens([FRONT])?.id).toBe('front');
    expect(defaultNativeLens([])).toBeUndefined();
  });

  it('among main back lenses takes the one that records fastest', () => {
    const slow = lens('slow', 'back', 'wide', [[1920, 1080, 120]]);
    expect(defaultNativeLens([slow, BACK])?.id).toBe('back-wide');
  });

  it("records at the asked rate, else the nearest above it, else the lens's best", () => {
    expect(pickHfrFps([240, 120], undefined)).toBe(240);
    expect(pickHfrFps([240, 120], 120)).toBe(120);
    expect(pickHfrFps([240], 120)).toBe(240);
    expect(pickHfrFps([120], 240)).toBe(120);
    expect(pickHfrFps([], 240)).toBeNull();
  });

  it("picks the format closest in size to the event's resolution, at the chosen rate", () => {
    expect(pickHfrFormat(BACK, { width: 1920, height: 1080 }, 240)).toEqual({ width: 1920, height: 1080, fps: 240 });
    expect(pickHfrFormat(BACK, { width: 1280, height: 720 }, 240)).toEqual({ width: 1280, height: 720, fps: 240 });
    // 4K does 120 only: asking for 4K at 240 gets the largest picture that does 240.
    expect(pickHfrFormat(BACK, { width: 3840, height: 2160 }, 240)).toEqual({ width: 1920, height: 1080, fps: 240 });
    expect(pickHfrFormat(BACK, { width: 3840, height: 2160 }, 120)).toEqual({ width: 3840, height: 2160, fps: 120 });
    expect(pickHfrFormat(BACK, { width: 1920, height: 1080 }, 480)).toBeNull();
  });

  it("plans the default: main back lens, its best rate, the event's resolution", () => {
    const plan = planNativeHfr(CAPS, { deviceId: null }, '1080p');
    expect(plan.lens.id).toBe('back-wide');
    expect(plan.fps).toBe(240);
    expect(plan.format).toEqual({ width: 1920, height: 1080, fps: 240 });
  });

  it("keeps the operator's lens and frame rate", () => {
    const plan = planNativeHfr(CAPS, { deviceId: 'back-wide', hfrFps: 120 }, '2160p');
    expect(plan).toMatchObject({ fps: 120, format: { width: 3840, height: 2160 } });
    expect(planNativeHfr(CAPS, { deviceId: 'front', hfrFps: 240 }, '1080p')).toMatchObject({
      lens: { id: 'front' },
      fps: 120,
      format: { width: 1280, height: 720 },
    });
  });

  it('falls back to the default lens when the saved one is not on this device', () => {
    expect(planNativeHfr(CAPS, { deviceId: 'gone' }, '1080p').lens.id).toBe('back-wide');
  });

  it('refuses a device with no high-speed lens, with a code the booth explains', () => {
    const none = { lenses: [] };
    expect(() => planNativeHfr(none, { deviceId: null }, '1080p')).toThrowError(CameraError);
    try {
      planNativeHfr(none, { deviceId: null }, '1080p');
    } catch (err) {
      expect((err as CameraError).code).toBe('no_high_speed');
    }
  });
});

describe('toNativeHfrError', () => {
  const code = (c: string, message = '') => toNativeHfrError({ code: c, message }).code;

  it('maps what the plugin rejects with to codes the booth explains in three languages', () => {
    expect(code('permission_denied')).toBe('native_permission');
    expect(code('no_high_speed_format')).toBe('no_high_speed');
    expect(code('lens_not_found')).toBe('not_found');
    expect(code('busy')).toBe('in_use');
    expect(code('storage')).toBe('native_storage');
    expect(code('unsupported', "This phone's high-speed recorder cannot record sound.")).toBe('native_audio');
    expect(code('unsupported', 'fps, width and height are required.')).toBe('native_failed');
    expect(code('recording_failed')).toBe('native_failed');
    expect(code('session_failed')).toBe('native_failed');
    expect(toNativeHfrError(new Error('x')).code).toBe('native_failed');
  });

  it('passes a CameraError through', () => {
    const err = new CameraError('permission', 'x');
    expect(toNativeHfrError(err)).toBe(err);
  });
});

// -- a plugin to talk to ------------------------------------------------------------------------------------

type Handlers = { [event: string]: ((e: never) => void)[] };

function fakePlugin(over: Partial<Record<keyof HighSpeedPlugin, unknown>> = {}) {
  const handlers: Handlers = {};
  const removed: string[] = [];
  const defaults = {
    capabilities: vi.fn(async () => CAPS),
    checkPermissions: vi.fn(async () => ({ camera: 'granted', microphone: 'granted' })),
    requestPermissions: vi.fn(async () => ({ camera: 'granted', microphone: 'granted' })),
    startPreview: vi.fn(async (o: StartPreviewOptions): Promise<PreviewInfo> => ({
      lens: o.lens ?? 'back-wide',
      label: 'Back Camera',
      facing: o.lens === 'front' ? 'front' : 'back',
      kind: 'wide',
      width: o.width,
      height: o.height,
      fps: o.fps,
      mime: 'video/quicktime',
      codec: 'h264',
      audio: o.audio ?? false,
    })),
    setMirrored: vi.fn(async () => undefined),
    stopPreview: vi.fn(async () => undefined),
    startMotionSampling: vi.fn(async () => undefined),
    stopMotionSampling: vi.fn(async () => undefined),
    startRecording: vi.fn(async (o: { id: string }) => ({ id: o.id })),
    stopRecording: vi.fn(async (): Promise<NativeRecording> => RECORDING),
    deleteRecording: vi.fn(async () => undefined),
    listRecordings: vi.fn(async () => ({ recordings: [] })),
    addListener: vi.fn(async (event: string, cb: (e: never) => void) => {
      (handlers[event] ??= []).push(cb);
      return {
        remove: async () => {
          removed.push(event);
          handlers[event] = (handlers[event] ?? []).filter((h) => h !== cb);
        },
      };
    }),
    removeAllListeners: vi.fn(async () => undefined),
  };
  return {
    bridge: { ...defaults, ...over } as unknown as HighSpeedPlugin,
    /** The default mocks (what a test overrides is replaced on `bridge`, not here). */
    mocks: defaults,
    removed,
    /** Deliver an event from "the native side". */
    emit: (event: string, payload: unknown) => {
      for (const h of handlers[event] ?? []) (h as (e: unknown) => void)(payload);
    },
    listening: (event: string) => (handlers[event] ?? []).length,
  };
}

const RECORDING: NativeRecording = {
  id: 'take-1',
  path: 'file:///var/x/take-1.hfr',
  mime: 'video/quicktime',
  bytes: 10,
  durationMs: 8000,
  width: 1920,
  height: 1080,
  fps: 240,
  codec: 'h264',
  interrupted: false,
};

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('openNativeHfrCamera', () => {
  const open = (p: ReturnType<typeof fakePlugin>, over: Partial<Parameters<typeof openNativeHfrCamera>[0]> = {}) =>
    openNativeHfrCamera({
      bridge: p.bridge,
      capabilities: CAPS,
      choice: { deviceId: null },
      resolution: '1080p',
      audio: false,
      mirror: false,
      ...over,
    });

  it('asks the plugin for the planned lens, rate and size, H.264, and reports what it settled on', async () => {
    const p = fakePlugin();
    const cam = await open(p, { audio: true, mirror: true });
    expect(p.mocks.startPreview).toHaveBeenCalledWith({
      lens: 'back-wide',
      fps: 240,
      width: 1920,
      height: 1080,
      codec: 'h264',
      mirror: true,
      audio: true,
    });
    expect(cam).toMatchObject({
      kind: 'native-hfr',
      mime: 'video/quicktime',
      fps: 240,
      audio: true,
      lens: { facing: 'back', kind: 'wide' },
      settings: { width: 1920, height: 1080, frameRate: 240, deviceId: 'back-wide', facingMode: 'environment' },
      applied: { zoom: null, torch: false },
    });
    // No light or zoom on the native camera: the drawer shows them as unsupported, as for any camera without them.
    expect(cam.torch.supported).toBe(false);
    expect(cam.zoom.range).toBeNull();
    expect(await cam.torch.set(true)).toEqual({ ok: false, reason: 'unsupported' });
    cam.stop();
  });

  it('turns a refusal into an error the booth can explain', async () => {
    const p = fakePlugin({
      startPreview: vi.fn(async () => {
        throw Object.assign(new Error('Permission to use the camera was refused.'), { code: 'permission_denied' });
      }),
    });
    await expect(open(p)).rejects.toMatchObject({ name: 'CameraError', code: 'native_permission' });
    expect(p.mocks.stopPreview).not.toHaveBeenCalled();
  });

  it('says so when the device has no high-speed lens at all, without bothering the plugin', async () => {
    const p = fakePlugin();
    await expect(open(p, { capabilities: { ...CAPS, available: false, lenses: [] } })).rejects.toMatchObject({
      code: 'no_high_speed',
    });
    expect(p.mocks.startPreview).not.toHaveBeenCalled();
  });

  it('mirrors the native view, and stops it once', async () => {
    const p = fakePlugin();
    const cam = await open(p);
    cam.setMirrored(true);
    expect(p.mocks.setMirrored).toHaveBeenCalledWith({ mirrored: true });
    cam.stop();
    cam.stop();
    expect(p.mocks.stopPreview).toHaveBeenCalledTimes(1);
  });

  it('does not stop the session of a camera that replaced it (a double tap on Start)', async () => {
    const p = fakePlugin();
    const first = await open(p);
    const second = await open(p);
    first.stop();
    expect(p.mocks.stopPreview).not.toHaveBeenCalled();
    second.stop();
    expect(p.mocks.stopPreview).toHaveBeenCalledTimes(1);
  });

  it('hands errors and interruptions to whoever listens, until it stops', async () => {
    const p = fakePlugin();
    const cam = await open(p);
    const seen: NativeHfrEvent[] = [];
    cam.onEvent((e) => seen.push(e));
    await settle();
    p.emit('interruption', { reason: 'thermal', state: 'began', recording: true });
    p.emit('error', { code: 'session_failed', message: 'gone', fatal: true });
    expect(seen).toEqual([
      { kind: 'interruption', reason: 'thermal', state: 'began', recording: true },
      { kind: 'error', code: 'session_failed', message: 'gone', fatal: true },
    ]);
    cam.stop();
    await settle();
    expect(p.listening('error')).toBe(0);
    expect(p.listening('interruption')).toBe(0);
    p.emit('error', { code: 'busy', message: '', fatal: false });
    expect(seen).toHaveLength(2);
  });

  it('feeds the motion trigger luma grids, only while subscribed', async () => {
    const p = fakePlugin();
    const cam = await open(p);
    const frames: Uint8Array[] = [];
    const off = cam.motion.subscribe((f) => frames.push(f));
    await settle();
    expect(p.mocks.startMotionSampling).toHaveBeenCalledWith({ intervalMs: 100 });

    const luma = Uint8Array.from({ length: GRID_W * GRID_H }, (_, i) => i % 256);
    p.emit('motionFrame', { luma: btoa(String.fromCharCode(...luma)), width: GRID_W, height: GRID_H });
    // A grid of another size is not the detector's input.
    p.emit('motionFrame', { luma: btoa('abc'), width: 3, height: 1 });
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0]!)).toEqual(Array.from(luma));

    off();
    await settle();
    expect(p.mocks.stopMotionSampling).toHaveBeenCalled();
    expect(p.listening('motionFrame')).toBe(0);
    cam.stop();
  });

  it('knows whether the device can be sampled for motion at all', async () => {
    const p = fakePlugin();
    const cam = await open(p, { capabilities: { ...CAPS, motionSampling: false } });
    expect(cam.motion.supported).toBe(false);
    cam.stop();
  });
});

describe('decodeLuma', () => {
  it('reads exactly one grid of the size the detector uses', () => {
    const bytes = new Uint8Array(GRID_W * GRID_H).fill(7);
    const encoded = btoa(String.fromCharCode(...bytes));
    expect(decodeLuma(encoded, GRID_W, GRID_H)).toEqual(bytes);
    expect(decodeLuma(encoded, GRID_W, GRID_H + 1)).toBeNull();
    expect(decodeLuma(btoa('short'), GRID_W, GRID_H)).toBeNull();
    expect(decodeLuma('%%%not base64%%%', GRID_W, GRID_H)).toBeNull();
  });
});

// -- the file hand-off --------------------------------------------------------------------------------------

/** A fetch that serves `chunks` as a streamed body, as Capacitor's file server does. */
function fileFetch(chunks: number[][], init: ResponseInit = {}): typeof fetch {
  return (async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(Uint8Array.from(c));
        controller.close();
      },
    });
    return new Response(stream, init);
  }) as typeof fetch;
}

const bytesOf = async (blobs: Blob[]) => Array.from(new Uint8Array(await new Blob(blobs).arrayBuffer()));

describe('readNativeFile', () => {
  it('reads the file in slices, in order, without ever holding more than a slice and a chunk', async () => {
    const chunks = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], [13]];
    const blobs: Blob[] = [];
    for await (const b of readNativeFile('x', { sliceBytes: 6, fetchImpl: fileFetch(chunks) })) blobs.push(b);
    expect(blobs.map((b) => b.size)).toEqual([6, 6, 1]);
    expect(await bytesOf(blobs)).toEqual(chunks.flat());
  });

  it('hands a file smaller than a slice over whole', async () => {
    const blobs: Blob[] = [];
    for await (const b of readNativeFile('x', { fetchImpl: fileFetch([[1, 2], [3]]) })) blobs.push(b);
    expect(blobs).toHaveLength(1);
    expect(NATIVE_SLICE_BYTES).toBeGreaterThan(1024 * 1024);
  });

  it('says so when the file cannot be read, rather than storing nothing', async () => {
    const drain = async (fetchImpl: typeof fetch) => {
      for await (const slice of readNativeFile('x', { fetchImpl })) void slice;
    };
    await expect(drain(fileFetch([], { status: 404 }))).rejects.toMatchObject({ code: 'native_failed' });
    await expect(
      drain((async () => {
        throw new TypeError('Load failed');
      }) as typeof fetch),
    ).rejects.toMatchObject({ code: 'native_failed' });
  });
});

describe('NativeTakeRecorder (take hand-off)', () => {
  const file = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10],
  ];

  function recorder(
    p: ReturnType<typeof fakePlugin>,
    onChunk = vi.fn(async (_chunk: Blob, _index: number) => undefined),
    extra: { now?: () => number } = {},
  ) {
    const rec = new NativeTakeRecorder(
      { bridge: p.bridge },
      {
        takeId: 'take-1',
        onChunk,
        readFile: (path) => {
          expect(path).toBe(RECORDING.path);
          return readNativeFile('x', { sliceBytes: 4, fetchImpl: fileFetch(file) });
        },
        ...extra,
      },
    );
    return { rec, onChunk };
  }

  it('names the native file after the take, so a crash leaves it findable', async () => {
    const p = fakePlugin();
    const { rec } = recorder(p);
    await rec.start();
    expect(p.mocks.startRecording).toHaveBeenCalledWith({ id: 'take-1' });
  });

  it('copies the finished file into the take store in order, then deletes the native copy', async () => {
    const p = fakePlugin();
    const { rec, onChunk } = recorder(p);
    await rec.start();
    const result = await rec.stop();

    expect(onChunk.mock.calls.map((c) => c[1])).toEqual([0, 1, 2]);
    const stored = onChunk.mock.calls.map((c) => c[0]);
    expect(await bytesOf(stored)).toEqual(file.flat());
    expect(result).toEqual({ mimeType: 'video/quicktime', durationMs: 8000, bytes: 10, chunks: 3 });
    // The copy is durable before the original goes.
    const order = [p.mocks.stopRecording, p.mocks.deleteRecording].map((m) => m.mock.invocationCallOrder[0]!);
    expect(order[0]).toBeLessThan(order[1]!);
    expect(p.mocks.deleteRecording).toHaveBeenCalledWith({ id: 'take-1' });
  });

  it('stops once however many times it is asked', async () => {
    const p = fakePlugin();
    const { rec } = recorder(p);
    await rec.start();
    const [a, b] = [rec.stop(), rec.stop()];
    expect(a).toBe(b);
    await a;
    expect(p.mocks.stopRecording).toHaveBeenCalledTimes(1);
  });

  it('keeps the native file when the bytes do not add up, so the next start can bring it in again', async () => {
    const p = fakePlugin({ stopRecording: vi.fn(async () => ({ ...RECORDING, bytes: 11 })) });
    const { rec } = recorder(p);
    await rec.start();
    await expect(rec.stop()).rejects.toMatchObject({ code: 'native_failed' });
    expect(p.mocks.deleteRecording).not.toHaveBeenCalled();
  });

  it('keeps the native file when the take store fails to take a slice', async () => {
    const p = fakePlugin();
    const failing = vi.fn(async (_chunk: Blob, _index: number) => {
      throw new Error('disk full');
    });
    const { rec } = recorder(p, failing);
    await rec.start();
    await expect(rec.stop()).rejects.toThrow('disk full');
    expect(p.mocks.deleteRecording).not.toHaveBeenCalled();
  });

  it('collects a take the camera ended early (an interruption) like any other', async () => {
    const p = fakePlugin({ stopRecording: vi.fn(async () => ({ ...RECORDING, interrupted: true })) });
    const { rec } = recorder(p);
    await rec.start();
    await expect(rec.stop()).resolves.toMatchObject({ bytes: 10 });
  });

  it('explains a camera that would not start recording', async () => {
    const p = fakePlugin({
      startRecording: vi.fn(async () => {
        throw Object.assign(new Error('almost out of storage'), { code: 'storage' });
      }),
    });
    const { rec } = recorder(p);
    await expect(rec.start()).rejects.toMatchObject({ code: 'native_storage' });
  });

  it('counts the time from when the camera is writing, and reports the recorded length once stopped', async () => {
    let now = 1000;
    const p = fakePlugin();
    const { rec } = recorder(p, undefined, { now: () => now });
    expect(rec.elapsedMs).toBe(0);
    await rec.start();
    now = 3500;
    expect(rec.elapsedMs).toBe(2500);
    await rec.stop();
    now = 99_000;
    expect(rec.elapsedMs).toBe(8000);
  });
});
