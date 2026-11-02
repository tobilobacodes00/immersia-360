import {
  TakeRecorder,
  extensionFor,
  openCamera,
  openSimulatedCamera,
  pickRecordingMime,
  recordingBitrate,
  toCameraError,
  type OpenedCamera,
} from '@immersia/capture';
import { requestPersistence, storageHealth, takeStore, type TakeStore } from '@immersia/offline';
import { createOpfsWorker } from '@immersia/offline/opfs-worker';
import { outputSize, videoBitrate, type EncoderKind, type RenderJob } from '@immersia/render-engine';
import { RenderClient, RenderFailure } from '@immersia/render-engine/client';
import { localEncoder } from '@/lib/device-ladder';
import { workerUrl } from '@/lib/workers';
import {
  REFERENCE_CLIP,
  TEST_TAKE_SECONDS,
  estimateClipMs,
  testSlowMotion,
  type RenderMeasurement,
} from '@/lib/setup-check/render-estimate';
import { testBackground, type CheckPlan } from '@/lib/setup-check/config';
import { isAppleTouchDevice, isStandalone, sleep } from '@/lib/setup-check/measure';
import { usableChoice, type CameraChoice } from '../camera-choice';
import type { CheckApi } from './check-api';

/** Time to give the persistence request before moving on: some browsers leave it pending (Booth360 does the same). */
const PERSIST_WAIT_MS = 3000;
const UPLOAD_PROBE_BYTES = 1024 * 1024;

export interface StorageProbe {
  available: boolean;
  persisted: boolean;
  freeBytes: number | null;
  backend: 'opfs' | 'idb';
  apple: boolean;
  standalone: boolean;
}

export interface TestTake {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  bytes: number;
  chunks: number;
  width: number;
  height: number;
  fps: number;
}

export type TakeOutcome = { kind: 'recorded'; take: TestTake } | { kind: 'unsupported' } | { kind: 'writeFailed' };

export type RenderOutcome =
  | {
      kind: 'done';
      measurement: RenderMeasurement;
      /** The reference clip (15 s, 1080p, 30 fps) at the measured speed. */
      referenceMs: number;
      /** A 15 s clip of the event's own preset (resolution and frame rate) at the measured speed. */
      eventMs: number;
      interpolatedFrames: number;
      /** CAP-10: whether the background the event asks for was replaced in the test render. */
      background: 'none' | 'applied' | 'unavailable';
      /** The ladder's on-device encoder the test render used: the browser's own, or the WebAssembly one where it has none. */
      encoder: EncoderKind;
    }
  | { kind: 'error'; code: string };

export type NetworkOutcome =
  | { kind: 'ok'; mbps: number }
  | {
      kind: 'error';
      code:
        'offline' | 'unauthorized' | 'storage_unavailable' | 'rate_limited' | 'put_failed' | 'incomplete' | 'failed';
    };

/**
 * Everything the setup check holds on to between steps: the open camera, the on-device take store,
 * the test take and the render worker. It runs the booth's own code paths (the camera helpers, the
 * take recorder and store, the render engine) so a pass means the booth will work, not that a copy
 * of it did. Plain TypeScript, created once per page; the steps call it from event handlers.
 */
export class CheckSession {
  camera: OpenedCamera | null = null;
  take: TestTake | null = null;
  private store: TakeStore | null = null;
  private takePath: string | null = null;
  private renderer: RenderClient | null = null;
  private opening = 0;

  constructor(
    readonly plan: CheckPlan,
    readonly deviceId: string,
    readonly api: CheckApi,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Camera

  /** Open the chosen camera as the booth would; any camera already open is released first. */
  async openCamera(saved: CameraChoice): Promise<{ ok: true; camera: OpenedCamera } | { ok: false; code: string }> {
    const ticket = ++this.opening;
    this.closeCamera();
    // The check exercises the browser's camera path. The saved choice is shared with the booth, which may have chosen
    // the companion's native high-speed camera (CAP-14): its lens id means nothing to the browser, so it reads as
    // the default camera here (as it does in the booth outside the companion).
    const choice = usableChoice(saved, false);
    try {
      const { resolution, frameRate, audio } = this.plan.camera;
      const camera =
        choice.source === 'simulator'
          ? openSimulatedCamera({ resolution, frameRate })
          : await openCamera({
              deviceId: choice.deviceId,
              resolution,
              frameRate,
              audio,
              // As the booth does: a restart resets zoom and light, so the saved choice is put back.
              restore: { zoom: choice.zoom, torch: choice.torch },
            });
      // A newer request (the operator picked another camera meanwhile) owns the device now.
      if (ticket !== this.opening) {
        camera.stop();
        return { ok: false, code: 'superseded' };
      }
      this.camera = camera;
      return { ok: true, camera };
    } catch (err) {
      return { ok: false, code: toCameraError(err).code };
    }
  }

  closeCamera() {
    this.camera?.stop();
    this.camera = null;
  }

  // ---------------------------------------------------------------------------------------------
  // Storage

  private async ensureStore(): Promise<TakeStore> {
    this.store ??= await takeStore(() => createOpfsWorker(workerUrl('opfs')));
    return this.store;
  }

  async probeStorage(): Promise<StorageProbe> {
    const available = typeof navigator.storage?.estimate === 'function';
    const persisted = await Promise.race([requestPersistence(), sleep(PERSIST_WAIT_MS).then(() => false)]);
    const health = await storageHealth();
    let backend: StorageProbe['backend'] = 'idb';
    try {
      backend = (await this.ensureStore()).backend;
    } catch {
      // The store couldn't start at all: leave the IndexedDB label, the take step will report the failure.
    }
    return {
      available,
      persisted: persisted || health.persisted,
      freeBytes: health.free,
      backend,
      apple: isAppleTouchDevice(),
      standalone: isStandalone(),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Test take

  /**
   * Record a few seconds through the booth's capture path: the same recorder and container choice,
   * written chunk by chunk to the on-device store, then read back whole. `onProgress` gets 0..1.
   */
  async recordTestTake(onProgress: (share: number) => void): Promise<TakeOutcome> {
    const camera = this.camera;
    if (!camera) return { kind: 'writeFailed' };
    const mime =
      typeof MediaRecorder === 'undefined' ? null : pickRecordingMime((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) return { kind: 'unsupported' };
    await this.discardTake();
    const path = `takes/check/${this.deviceId}.${extensionFor(mime)}`;
    this.takePath = path;
    let bytes = 0;
    let chunks = 0;
    try {
      const store = await this.ensureStore();
      await store.begin(path);
      const recorder = new TakeRecorder(camera.stream, {
        mimeType: mime,
        videoBitsPerSecond: recordingBitrate(camera.settings.width, camera.settings.height, camera.settings.frameRate),
        onChunk: async (chunk) => {
          await store.append(path, chunk);
          bytes += chunk.size;
          chunks++;
        },
      });
      recorder.start();
      const ticker = setInterval(() => onProgress(Math.min(1, recorder.elapsedMs / (TEST_TAKE_SECONDS * 1000))), 100);
      await sleep(TEST_TAKE_SECONDS * 1000);
      clearInterval(ticker);
      onProgress(1);
      const result = await recorder.stop();
      await store.finish(path);
      const mimeType = mime.split(';')[0]!;
      const blob = await store.read(path, mimeType);
      const take: TestTake = {
        blob,
        mimeType,
        durationMs: result.durationMs,
        bytes: blob.size || bytes,
        chunks: result.chunks || chunks,
        width: camera.settings.width,
        height: camera.settings.height,
        fps: camera.settings.frameRate,
      };
      this.take = take;
      return { kind: 'recorded', take };
    } catch (err) {
      console.warn('[setup check] test take', err);
      return { kind: 'writeFailed' };
    }
  }

  /** Remove the test take from the device: a check must leave nothing behind. */
  async discardTake() {
    this.take = null;
    const path = this.takePath;
    this.takePath = null;
    if (path && this.store) await this.store.remove(path).catch(() => undefined);
  }

  // ---------------------------------------------------------------------------------------------
  // Render speed

  /** Render the test take with the event's output preset in the real render worker. */
  async renderTestTake(onProgress: (share: number) => void): Promise<RenderOutcome> {
    const take = this.take;
    if (!take) return { kind: 'error', code: 'failed' };
    const video = this.plan.render;
    const size = outputSize(video.resolution, video.aspect);
    const job: RenderJob = {
      take: take.blob,
      output: { ...size, fps: video.fps, bitrate: videoBitrate(video.quality, size.width, size.height, video.fps) },
      slowMotion: testSlowMotion(video.slowMotion, take.durationMs / 1000),
      reverse: video.reverse,
      look: video.filterId ? { id: video.filterId, intensity: 1 } : null,
      effects: video.effects.map((e) => ({ id: e.id, intensity: e.intensity, colorMode: e.colorMode ?? null })),
      beats: [],
      seed: 0,
      background: testBackground(video.background),
    };
    this.renderer ??= new RenderClient(() => new Worker(workerUrl('render'), { type: 'module' }));
    try {
      // The ladder's on-device rungs, as the booth chooses them: the browser's own H.264 encoder, or the
      // WebAssembly one where it has none (so such a device is measured on the path it will really render on).
      const encoder = await localEncoder();
      const result = await this.renderer.render(`check:${this.deviceId}`, job, onProgress, encoder).result;
      const measurement: RenderMeasurement = {
        renderMs: result.renderMs,
        frames: result.frames,
        width: result.width,
        height: result.height,
      };
      const referenceMs = estimateClipMs(measurement, REFERENCE_CLIP);
      const eventMs = estimateClipMs(measurement, {
        seconds: REFERENCE_CLIP.seconds,
        fps: video.fps,
        width: size.width,
        height: size.height,
      });
      if (referenceMs === null || eventMs === null) return { kind: 'error', code: 'failed' };
      return {
        kind: 'done',
        measurement,
        referenceMs,
        eventMs,
        interpolatedFrames: result.interpolatedFrames,
        background: result.background,
        encoder,
      };
    } catch (err) {
      console.warn('[setup check] render', err);
      return { kind: 'error', code: err instanceof RenderFailure ? err.code : 'failed' };
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Network

  /** Presign, upload a megabyte straight to storage as a guest's file would be, and have the server verify and delete it. */
  async uploadProbe(): Promise<NetworkOutcome> {
    if (!navigator.onLine) return { kind: 'error', code: 'offline' };
    const fail = (status: number, code: string): NetworkOutcome => ({
      kind: 'error',
      code:
        status === 0
          ? 'offline'
          : status === 401
            ? 'unauthorized'
            : status === 429
              ? 'rate_limited'
              : code === 'storage_unavailable'
                ? 'storage_unavailable'
                : 'failed',
    });
    const started = await this.api.startUpload();
    if (!started.ok) return fail(started.status, started.code);
    const { id, ticket } = started.data;
    const body = randomBlob(UPLOAD_PROBE_BYTES);
    const t0 = performance.now();
    try {
      const res = await fetch(ticket.url, { method: ticket.method, headers: ticket.headers, body });
      if (!res.ok) return { kind: 'error', code: 'put_failed' };
    } catch {
      return { kind: 'error', code: 'put_failed' };
    }
    const seconds = Math.max(0.001, (performance.now() - t0) / 1000);
    const finished = await this.api.finishUpload(id);
    if (!finished.ok) return fail(finished.status, finished.code);
    if (finished.data.result !== 'ok') return { kind: 'error', code: 'incomplete' };
    return { kind: 'ok', mbps: (UPLOAD_PROBE_BYTES * 8) / 1_000_000 / seconds };
  }

  // ---------------------------------------------------------------------------------------------

  /** Release the camera and worker and remove the test take. */
  async dispose() {
    this.closeCamera();
    this.renderer?.dispose();
    this.renderer = null;
    await this.discardTake();
  }
}

/** Incompressible bytes, so a proxy that squeezes uploads can't flatter the measurement. */
function randomBlob(bytes: number): Blob {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (let left = bytes; left > 0; left -= 65_536) {
    const chunk = new Uint8Array(Math.min(left, 65_536));
    crypto.getRandomValues(chunk);
    parts.push(chunk);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}
