/**
 * The `native-hfr` camera source (CAP-14): the Immersia companion app's native 120-240 fps recorder
 * (`@immersia/capacitor-high-speed`), used where a browser cannot record that fast. It exists only inside
 * the companion, which wraps this same booth web app; everywhere else `detectNativeHfr()` is false, nothing
 * of it is loaded, and the booth uses its web cameras exactly as before.
 *
 * The plugin itself is passed in (the app loads it with a dynamic import), so this module has no runtime
 * dependency on Capacitor and costs the browser bundle nothing. Only its types are imported.
 */
import type {
  HighSpeedCapabilities,
  HighSpeedErrorEvent,
  HighSpeedFormat,
  HighSpeedInterruptionEvent,
  HighSpeedLens,
  HighSpeedPlugin,
  PreviewInfo,
  RecordingResult as NativeRecording,
} from '@immersia/capacitor-high-speed';
import { RESOLUTION_SIZE, CameraError, type OpenedCamera, type Resolution } from './camera';
import type { LensClass } from './lenses';
import { GRID_H, GRID_W } from './motion';
import type { RecordingResult, TakeCapture } from './recorder';

export type { HighSpeedCapabilities, HighSpeedFormat, HighSpeedLens, HighSpeedPlugin };

/** The plugin's name on both platforms; `Capacitor.isPluginAvailable` answers for it. */
export const NATIVE_HFR_PLUGIN = 'HighSpeed';

/** The `source` of a camera choice that records through the companion's native camera. */
export const NATIVE_HFR_SOURCE = 'native-hfr';

// -- Detection ---------------------------------------------------------------------------------------------

/** The part of the `window.Capacitor` global the booth uses; the native shell injects it, no package needed. */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  convertFileSrc?: (path: string) => string;
}

type CapacitorHost = { Capacitor?: CapacitorGlobal };

/**
 * Whether this page runs inside the companion app and the native recorder is part of it. Synchronous and
 * free of imports: a browser has no `Capacitor` global, so it is false there without loading anything.
 */
export function detectNativeHfr(host: CapacitorHost = globalThis as CapacitorHost): boolean {
  const capacitor = host.Capacitor;
  if (!capacitor) return false;
  try {
    return capacitor.isNativePlatform?.() === true && capacitor.isPluginAvailable?.(NATIVE_HFR_PLUGIN) === true;
  } catch {
    return false;
  }
}

/** Capacitor's conversion of a native file path to a URL the WebView can fetch (`convertFileSrc`). */
export function nativeFileUrl(path: string, host: CapacitorHost = globalThis as CapacitorHost): string {
  const convert = host.Capacitor?.convertFileSrc;
  if (!convert) throw new CameraError('native_failed', 'The companion app cannot read its recordings.');
  return convert(path);
}

// -- Lenses, formats and the operator's choice -------------------------------------------------------------

/** Frame rates a lens records, highest first. */
export function hfrFpsOptions(lens: HighSpeedLens | undefined): number[] {
  if (!lens) return [];
  return [...new Set(lens.formats.map((f) => f.fps))].sort((a, b) => b - a);
}

/** The lens the booth uses when none was chosen: the main back lens, then any back lens, then any. */
export function defaultNativeLens(lenses: readonly HighSpeedLens[]): HighSpeedLens | undefined {
  const best = (list: readonly HighSpeedLens[]) =>
    [...list].sort((a, b) => (hfrFpsOptions(b)[0] ?? 0) - (hfrFpsOptions(a)[0] ?? 0))[0];
  const back = lenses.filter((l) => l.facing === 'back');
  const mainBack = back.filter((l) => l.kind === 'wide');
  return best(mainBack) ?? best(back) ?? best(lenses);
}

/** The frame rate to record at: the one asked for if the lens has it, else the nearest above, else its best. */
export function pickHfrFps(options: readonly number[], wanted: number | undefined): number | null {
  if (options.length === 0) return null;
  const sorted = [...options].sort((a, b) => a - b);
  const best = sorted[sorted.length - 1] ?? null;
  if (wanted === undefined) return best;
  return sorted.find((f) => f >= wanted) ?? best;
}

/** Of the lens's formats at `fps`, the one whose picture is closest in size to the event's resolution. */
export function pickHfrFormat(
  lens: HighSpeedLens,
  size: { width: number; height: number },
  fps: number,
): HighSpeedFormat | null {
  const wanted = size.width * size.height;
  const candidates = lens.formats.filter((f) => f.fps === fps);
  let best: HighSpeedFormat | null = null;
  for (const format of candidates) {
    if (!best || Math.abs(format.width * format.height - wanted) < Math.abs(best.width * best.height - wanted)) {
      best = format;
    }
  }
  return best;
}

export interface NativeHfrChoice {
  /** A lens id from `capabilities()`; null for the default lens. */
  deviceId: string | null;
  /** The frame rate the operator asked for; absent means the lens's best. */
  hfrFps?: number;
}

export interface NativeHfrPlan {
  lens: HighSpeedLens;
  fps: number;
  format: HighSpeedFormat;
}

/**
 * What the saved choice and the event's resolution come to on this device's lenses: which lens, at which
 * frame rate and picture size. A lens that is gone (the choice was saved on another device) falls back to the
 * default lens. Throws `no_high_speed` when the device has no lens that records 120 fps or more.
 */
export function planNativeHfr(
  capabilities: Pick<HighSpeedCapabilities, 'lenses'>,
  choice: NativeHfrChoice,
  resolution: Resolution,
): NativeHfrPlan {
  const lens = capabilities.lenses.find((l) => l.id === choice.deviceId) ?? defaultNativeLens(capabilities.lenses);
  if (!lens) throw new CameraError('no_high_speed', 'This device has no camera that records 120 fps or more.');
  const fps = pickHfrFps(hfrFpsOptions(lens), choice.hfrFps);
  const format = fps === null ? null : pickHfrFormat(lens, RESOLUTION_SIZE[resolution], fps);
  if (fps === null || !format) throw new CameraError('no_high_speed', `${lens.label} has no high-speed format.`);
  return { lens, fps, format };
}

export function nativeLensClass(lens: Pick<HighSpeedLens, 'facing' | 'kind'>): LensClass {
  return { facing: lens.facing, kind: lens.kind };
}

// -- Errors ------------------------------------------------------------------------------------------------

/** Map what the plugin rejects with (a Capacitor error carrying a `code`) to a code the booth can explain. */
export function toNativeHfrError(err: unknown): CameraError {
  if (err instanceof CameraError) return err;
  const code = (err as { code?: unknown } | null)?.code;
  const message = (err as { message?: unknown } | null)?.message;
  const text = typeof message === 'string' ? message : String(err);
  switch (code) {
    case 'permission_denied':
      return new CameraError('native_permission', text);
    case 'no_high_speed_format':
      return new CameraError('no_high_speed', text);
    case 'lens_not_found':
      return new CameraError('not_found', text);
    case 'busy':
      return new CameraError('in_use', text);
    case 'storage':
      return new CameraError('native_storage', text);
    case 'unsupported':
      // The only unsupported case a booth can hit is sound the recorder cannot carry.
      return new CameraError(/sound|microphone/i.test(text) ? 'native_audio' : 'native_failed', text);
    default:
      return new CameraError('native_failed', text);
  }
}

// -- The open camera ---------------------------------------------------------------------------------------

/** What a failure or interruption of the native camera means to the booth. */
export type NativeHfrEvent =
  | { kind: 'error'; code: HighSpeedErrorEvent['code']; message: string; fatal: boolean }
  | {
      kind: 'interruption';
      reason: HighSpeedInterruptionEvent['reason'];
      state: 'began' | 'ended';
      recording: boolean;
    };

export interface OpenedNativeCamera {
  kind: 'native-hfr';
  label: string;
  /** The plugin, for the recorder that goes with this camera. */
  bridge: HighSpeedPlugin;
  /** Container of the recordings, and so of the take's file. */
  mime: string;
  settings: OpenedCamera['settings'];
  lens: LensClass;
  /** No light and no zoom on the native camera yet: the drawer shows them as unsupported, as for any such camera. */
  torch: OpenedCamera['torch'];
  zoom: OpenedCamera['zoom'];
  applied: OpenedCamera['applied'];
  /** Every frame is recorded at this rate (the take's `fps`). */
  fps: number;
  /** The recording carries sound. */
  audio: boolean;
  setMirrored: (mirrored: boolean) => void;
  /** Errors and interruptions (a call, the phone running hot); returns the way to stop listening. */
  onEvent: (listener: (event: NativeHfrEvent) => void) => () => void;
  /**
   * Luma grids for the motion trigger, about ten a second, only while subscribed. Null where the native
   * camera cannot be sampled.
   */
  motion: {
    supported: boolean;
    subscribe: (onFrame: (luma: Uint8Array) => void) => () => void;
  };
  stop: () => void;
}

/** The luma grid in a `motionFrame` event, or null if it is not the size the detector reads. */
export function decodeLuma(base64: string, width: number, height: number): Uint8Array | null {
  if (width !== GRID_W || height !== GRID_H) return null;
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  if (binary.length !== GRID_W * GRID_H) return null;
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** A listener's way to stop: works even when asked before the plugin has confirmed the listener. */
function track(handle: Promise<{ remove: () => Promise<void> }>): () => void {
  let resolved: { remove: () => Promise<void> } | null = null;
  let removed = false;
  void handle.then(
    (h) => {
      resolved = h;
      if (removed) void h.remove().catch(() => undefined);
    },
    () => undefined,
  );
  return () => {
    if (removed) return;
    removed = true;
    if (resolved) void resolved.remove().catch(() => undefined);
  };
}

export interface OpenNativeHfrOptions {
  bridge: HighSpeedPlugin;
  capabilities: HighSpeedCapabilities;
  choice: NativeHfrChoice;
  resolution: Resolution;
  /** The event records sound (CAP-15). */
  audio: boolean;
  /** Mirror the on-screen preview only. */
  mirror: boolean;
}

/**
 * There is one native session. A camera that was opened and then replaced before its open finished (a double
 * tap, a lens picked mid-start) must not stop the session of the camera that replaced it, so each open takes
 * a number and only the newest one's `stop()` reaches the plugin.
 */
let latestOpen = 0;

/**
 * Open the native camera (CAP-14): the preview appears behind the transparent WebView, ready to record.
 * Rejects with a `CameraError` the booth can explain (permission refused, no high-speed format, ...).
 */
export async function openNativeHfrCamera(opts: OpenNativeHfrOptions): Promise<OpenedNativeCamera> {
  const { bridge, capabilities } = opts;
  const plan = planNativeHfr(capabilities, opts.choice, opts.resolution);
  const mine = ++latestOpen;
  let info: PreviewInfo;
  try {
    info = await bridge.startPreview({
      lens: plan.lens.id,
      fps: plan.fps,
      width: plan.format.width,
      height: plan.format.height,
      // H.264 decodes everywhere the renderer runs; the plugin falls back to it where HEVC is not offered.
      codec: 'h264',
      mirror: opts.mirror,
      audio: opts.audio,
    });
  } catch (err) {
    throw toNativeHfrError(err);
  }

  const listeners = new Set<(event: NativeHfrEvent) => void>();
  const emit = (event: NativeHfrEvent) => {
    for (const listener of listeners) listener(event);
  };
  const stops = [
    track(
      bridge.addListener('error', (e) => emit({ kind: 'error', code: e.code, message: e.message, fatal: e.fatal })),
    ),
    track(
      bridge.addListener('interruption', (e) =>
        emit({ kind: 'interruption', reason: e.reason, state: e.state, recording: e.recording }),
      ),
    ),
  ];

  const lens = nativeLensClass(info);
  let stopped = false;
  return {
    kind: 'native-hfr',
    label: info.label,
    bridge,
    mime: info.mime,
    settings: {
      width: info.width,
      height: info.height,
      frameRate: info.fps,
      deviceId: info.lens,
      facingMode: info.facing === 'front' ? 'user' : info.facing === 'back' ? 'environment' : null,
    },
    lens,
    torch: { supported: false, set: async () => ({ ok: false, reason: 'unsupported' }) },
    zoom: { range: null, set: async () => null },
    applied: { zoom: null, torch: false },
    fps: info.fps,
    audio: info.audio,
    setMirrored: (mirrored) => {
      void bridge.setMirrored({ mirrored }).catch(() => undefined);
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    motion: {
      supported: capabilities.motionSampling,
      subscribe: (onFrame) => {
        const stopListening = track(
          bridge.addListener('motionFrame', (e) => {
            const luma = decodeLuma(e.luma, e.width, e.height);
            if (luma) onFrame(luma);
          }),
        );
        void bridge.startMotionSampling({ intervalMs: 100 }).catch((err: unknown) => {
          emit({
            kind: 'error',
            code: 'unsupported',
            message: err instanceof Error ? err.message : 'Motion sampling failed.',
            fatal: false,
          });
        });
        return () => {
          stopListening();
          void bridge.stopMotionSampling().catch(() => undefined);
        };
      },
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      listeners.clear();
      for (const stopListening of stops) stopListening();
      // A newer open has already replaced this camera's session; stopping now would stop the newer one.
      if (latestOpen !== mine) return;
      void bridge.stopMotionSampling().catch(() => undefined);
      void bridge.stopPreview().catch(() => undefined);
    },
  };
}

// -- Recording and hand-off --------------------------------------------------------------------------------

/** Bytes per slice handed to the take store: a recording never has to fit in memory at once. */
export const NATIVE_SLICE_BYTES = 8 * 1024 * 1024;

/**
 * A native recording as a stream of blobs, read through the file URL Capacitor serves (no base64, no whole
 * file in memory): `slice` bytes at a time, in order.
 */
export async function* readNativeFile(
  url: string,
  opts: { sliceBytes?: number; fetchImpl?: typeof fetch } = {},
): AsyncGenerator<Blob, void, undefined> {
  const slice = opts.sliceBytes ?? NATIVE_SLICE_BYTES;
  const fetcher = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetcher(url);
  } catch (err) {
    throw new CameraError(
      'native_failed',
      `The recording could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok || !response.body) {
    throw new CameraError('native_failed', `The recording could not be read (HTTP ${response.status}).`);
  }
  const reader = response.body.getReader();
  let parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.byteLength;
      if (size >= slice) {
        yield new Blob(parts);
        parts = [];
        size = 0;
      }
    }
    if (size > 0) yield new Blob(parts);
  } finally {
    // An early exit (a failed write) must not leave the file open.
    await reader.cancel().catch(() => undefined);
  }
}

export interface NativeTakeRecorderOptions {
  /** The take's id: it names the native file, so a crash leaves the file findable. */
  takeId: string;
  /** Persist one slice of the finished file; must resolve only once the bytes are durable. */
  onChunk: (chunk: Blob, index: number) => Promise<void>;
  /** Where the finished file is read from; Capacitor's file URL by default. */
  readFile?: (path: string) => AsyncIterable<Blob>;
  /** The clock; tests pass their own. */
  now?: () => number;
}

/**
 * Records a take in the companion's native camera (CAP-14) and hands it to the take store.
 *
 * The camera writes a movie file at 120-240 fps; `stop()` finishes it, then reads it into the store slice by
 * slice (`onChunk`, the same contract as `TakeRecorder`) and checks the byte count against what the camera
 * wrote. Only then is the native copy deleted, so a failure anywhere leaves the file to be recovered at the
 * next start (see `recoverNativeTakes` in the booth).
 */
export class NativeTakeRecorder implements TakeCapture {
  private startedAt: number | null = null;
  private recordedMs: number | null = null;
  private stopped: Promise<RecordingResult> | null = null;
  private readonly now: () => number;

  constructor(
    private readonly camera: Pick<OpenedNativeCamera, 'bridge'>,
    private readonly opts: NativeTakeRecorderOptions,
  ) {
    this.now = opts.now ?? (() => performance.now());
  }

  get elapsedMs(): number {
    if (this.recordedMs !== null) return this.recordedMs;
    return this.startedAt === null ? 0 : this.now() - this.startedAt;
  }

  /** Resolves once the camera is writing frames; the spin length counts from here. */
  async start(): Promise<void> {
    try {
      await this.camera.bridge.startRecording({ id: this.opts.takeId });
    } catch (err) {
      throw toNativeHfrError(err);
    }
    this.startedAt = this.now();
  }

  /** Stop and wait until every slice has been persisted. Safe to call more than once. */
  stop(): Promise<RecordingResult> {
    this.stopped ??= this.finish();
    return this.stopped;
  }

  private async finish(): Promise<RecordingResult> {
    const { bridge } = this.camera;
    let recording: NativeRecording;
    try {
      recording = await bridge.stopRecording();
    } catch (err) {
      throw toNativeHfrError(err);
    }
    this.recordedMs = recording.durationMs;
    const chunks = this.opts.readFile
      ? this.opts.readFile(recording.path)
      : readNativeFile(nativeFileUrl(recording.path));
    let index = 0;
    let bytes = 0;
    for await (const chunk of chunks) {
      await this.opts.onChunk(chunk, index++);
      bytes += chunk.size;
    }
    if (bytes !== recording.bytes) {
      throw new CameraError(
        'native_failed',
        `The recording arrived with ${bytes} of ${recording.bytes} bytes; the original is kept on the device.`,
      );
    }
    // The bytes are in the take store: the native copy has done its job.
    await bridge.deleteRecording({ id: recording.id }).catch(() => undefined);
    return { mimeType: recording.mime, durationMs: recording.durationMs, bytes, chunks: index };
  }
}
