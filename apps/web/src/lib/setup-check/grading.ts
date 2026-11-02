/**
 * Grading for the setup check (HLP-1). Every function is pure: measurements in, findings out. A
 * finding is a status plus a stable code; the screen turns the code into wording that says what was
 * found and what to do about it (messages `check.<step>.findings.<code>`), so the same grading can be
 * tested exactly and translated freely.
 */
import type { SetupCheckStatus } from '@immersia/shared';
import { LOW_STORAGE_BYTES } from '@immersia/offline';

export type Graded = Exclude<SetupCheckStatus, 'skipped'>;
export type Params = Record<string, string | number>;
export interface Finding<C extends string = string> {
  status: Graded;
  code: C;
  params?: Params;
}

const RANK: Record<Graded, number> = { pass: 0, warn: 1, fail: 2 };

/** The worst status of a list of findings: a step is only as good as its weakest part. */
export function worst(findings: readonly { status: Graded }[]): Graded {
  return findings.reduce<Graded>((acc, f) => (RANK[f.status] > RANK[acc] ? f.status : acc), 'pass');
}

/** The worst of several step results; skipped steps don't count against the device. */
export function overall(statuses: readonly SetupCheckStatus[]): Graded {
  return worst(statuses.filter((s): s is Graded => s !== 'skipped').map((status) => ({ status })));
}

// -----------------------------------------------------------------------------------------------
// Camera

/** Below this a video looks like a slide show whatever the event asks for. */
export const FPS_FLOOR = 24;
/** Frame rates within this share of the target count as meeting it (cameras report 29.97 for 30). */
const FPS_TOLERANCE = 0.9;
const SIDE: Record<'720p' | '1080p' | '2160p', number> = { '720p': 720, '1080p': 1080, '2160p': 2160 };

export type CameraCode = 'ok' | 'simulator' | 'fpsBelowEvent' | 'fpsTooLow' | 'resolutionBelowEvent' | 'fpsUnmeasured';

export function gradeCamera(input: {
  simulator: boolean;
  /** The frame rate the event asks for. */
  targetFps: number;
  /** Measured from the live preview; null when the browser can't count frames. */
  measuredFps: number | null;
  targetResolution: '720p' | '1080p' | '2160p';
  width: number;
  height: number;
}): Finding<CameraCode>[] {
  const out: Finding<CameraCode>[] = [];
  if (input.simulator) out.push({ status: 'warn', code: 'simulator' });
  const { measuredFps: fps, targetFps } = input;
  if (fps === null) out.push({ status: 'warn', code: 'fpsUnmeasured' });
  else if (fps < FPS_FLOOR) out.push({ status: 'fail', code: 'fpsTooLow', params: { fps: Math.round(fps) } });
  else if (fps < targetFps * FPS_TOLERANCE)
    out.push({ status: 'warn', code: 'fpsBelowEvent', params: { fps: Math.round(fps), target: targetFps } });
  const short = Math.min(input.width, input.height);
  if (short < SIDE[input.targetResolution] * 0.95)
    out.push({
      status: 'warn',
      code: 'resolutionBelowEvent',
      params: { size: `${input.width}×${input.height}`, target: input.targetResolution },
    });
  return out.length ? out : [{ status: 'pass', code: 'ok' }];
}

/** The camera could not be opened: the codes `toCameraError` produces. */
export type CameraErrorCode = 'permission' | 'not_found' | 'in_use' | 'overconstrained' | 'insecure' | 'unknown';
export type CameraStepCode = CameraCode | CameraErrorCode;

const CAMERA_ERRORS: readonly string[] = ['permission', 'not_found', 'in_use', 'overconstrained', 'insecure'];

export function cameraOpenFailed(code: string): Finding<CameraStepCode>[] {
  return [{ status: 'fail', code: CAMERA_ERRORS.includes(code) ? (code as CameraErrorCode) : 'unknown' }];
}

// -----------------------------------------------------------------------------------------------
// Storage

/** Under this a long event can't be trusted to the device at all. */
export const CRITICAL_STORAGE_BYTES = 512 * 1024 ** 2;

export type StorageCode =
  | 'ok'
  | 'noStorage'
  | 'spaceUnknown'
  | 'lowSpace'
  | 'criticalSpace'
  | 'notPersisted'
  | 'notPersistedApple'
  | 'idbBackend';

export function gradeStorage(input: {
  /** `navigator.storage.persist()` / `persisted()` after asking. */
  persisted: boolean;
  /** Bytes free in this site's quota; null when the browser doesn't say. */
  freeBytes: number | null;
  /** Whether the browser has any storage API at all. */
  available: boolean;
  /** Where takes are written: the origin private file system, or the IndexedDB fallback. */
  backend: 'opfs' | 'idb';
  /** iPhone/iPad (including iPadOS posing as a Mac). */
  apple: boolean;
  /** Running as an installed app (added to the Home Screen). */
  standalone: boolean;
}): Finding<StorageCode>[] {
  if (!input.available) return [{ status: 'fail', code: 'noStorage' }];
  const out: Finding<StorageCode>[] = [];
  const gb = input.freeBytes === null ? 0 : Math.round((input.freeBytes / 1024 ** 3) * 10) / 10;
  if (input.freeBytes === null) out.push({ status: 'warn', code: 'spaceUnknown' });
  else if (input.freeBytes < CRITICAL_STORAGE_BYTES)
    out.push({ status: 'fail', code: 'criticalSpace', params: { gb } });
  else if (input.freeBytes < LOW_STORAGE_BYTES) out.push({ status: 'warn', code: 'lowSpace', params: { gb } });
  if (!input.persisted)
    out.push({ status: 'warn', code: input.apple && !input.standalone ? 'notPersistedApple' : 'notPersisted' });
  if (input.backend === 'idb') out.push({ status: 'warn', code: 'idbBackend' });
  return out.length ? out : [{ status: 'pass', code: 'ok' }];
}

// -----------------------------------------------------------------------------------------------
// Test take

export type TakeCode = 'ok' | 'short' | 'empty' | 'unsupported' | 'writeFailed' | 'noCamera';

/** How much of the requested length must be recorded for the take to count as complete. */
const TAKE_COMPLETE = 0.75;

export function gradeTake(
  input:
    | { kind: 'recorded'; requestedMs: number; recordedMs: number; bytes: number; chunks: number }
    | { kind: 'unsupported' }
    | { kind: 'writeFailed' }
    | { kind: 'noCamera' },
): Finding<TakeCode>[] {
  if (input.kind === 'noCamera') return [{ status: 'fail', code: 'noCamera' }];
  if (input.kind === 'unsupported') return [{ status: 'fail', code: 'unsupported' }];
  if (input.kind === 'writeFailed') return [{ status: 'fail', code: 'writeFailed' }];
  if (input.bytes <= 0 || input.chunks <= 0) return [{ status: 'fail', code: 'empty' }];
  if (input.recordedMs < input.requestedMs * TAKE_COMPLETE)
    return [
      {
        status: 'warn',
        code: 'short',
        params: { seconds: Math.round(input.recordedMs / 100) / 10, asked: Math.round(input.requestedMs / 1000) },
      },
    ];
  return [{ status: 'pass', code: 'ok' }];
}

// -----------------------------------------------------------------------------------------------
// Render speed

/** PRD (HLP-1, VID-9): a 15 s 1080p clip renders in at most 45 s on a laptop… */
export const RENDER_TARGET_LAPTOP_MS = 45_000;
/** …and at most 90 s on a 2021 iPad. */
export const RENDER_TARGET_TABLET_MS = 90_000;

export type RenderCode =
  | 'fast'
  | 'slower'
  | 'slow'
  | 'undecodable'
  | 'unsupported_encoder'
  | 'encoder_stall'
  | 'gpu'
  | 'cancelled'
  | 'noTake'
  | 'backgroundUnavailable'
  | 'failed';

const RENDER_FAILURES: readonly RenderCode[] = [
  'undecodable',
  'unsupported_encoder',
  'encoder_stall',
  'gpu',
  'cancelled',
  'noTake',
];

/**
 * Grade the estimated time for the reference clip (see render-estimate.ts), or a failed render.
 * `backgroundUnavailable`: the event replaces the background (CAP-10) but this device could not start the
 * person segmenter, so its videos would come out with the plain background.
 */
export function gradeRender(
  input: { kind: 'estimate'; referenceMs: number; backgroundUnavailable?: boolean } | { kind: 'error'; code: string },
): Finding<RenderCode>[] {
  if (input.kind === 'error') {
    const code = (RENDER_FAILURES as readonly string[]).includes(input.code) ? (input.code as RenderCode) : 'failed';
    return [{ status: 'fail', code }];
  }
  const seconds = Math.round(input.referenceMs / 1000);
  const speed: Finding<RenderCode> =
    input.referenceMs <= RENDER_TARGET_LAPTOP_MS
      ? { status: 'pass', code: 'fast', params: { seconds } }
      : input.referenceMs <= RENDER_TARGET_TABLET_MS
        ? { status: 'warn', code: 'slower', params: { seconds } }
        : { status: 'fail', code: 'slow', params: { seconds } };
  return input.backgroundUnavailable ? [speed, { status: 'warn', code: 'backgroundUnavailable' }] : [speed];
}

/**
 * The render path to record on the device (the Devices screen shows it): rendering on the device at
 * the target speed is `local`; a device whose test render needed the WebAssembly encoder (the browser
 * has none of its own, the ladder's `wasm` rung), or ran slower than the iPad target, is `wasm`
 * ("renders on device (slower)"); a device that can't render the test clip at all is `server`. It is
 * a hint: the booth records the rung that really produced its videos once it renders (the ladder).
 */
export function chooseRenderPath(
  input: { kind: 'estimate'; referenceMs: number; encoder?: 'native' | 'wasm' } | { kind: 'error' },
): 'local' | 'wasm' | 'server' {
  if (input.kind === 'error') return 'server';
  if (input.encoder === 'wasm') return 'wasm';
  return input.referenceMs <= RENDER_TARGET_TABLET_MS ? 'local' : 'wasm';
}

// -----------------------------------------------------------------------------------------------
// Test QR

export type QrCode = 'ok' | 'okLocalhost' | 'expired' | 'offline' | 'failed';

export function gradeQr(
  input: { kind: 'scanned'; localhost: boolean } | { kind: 'expired' | 'offline' | 'failed' },
): Finding<QrCode>[] {
  if (input.kind === 'scanned')
    return [input.localhost ? { status: 'warn', code: 'okLocalhost' } : { status: 'pass', code: 'ok' }];
  return [{ status: input.kind === 'expired' ? 'warn' : 'fail', code: input.kind }];
}

/** True for addresses a phone on the same network can't open. */
export const isLocalOrigin = (hostname: string) =>
  hostname === 'localhost' || hostname === '[::1]' || hostname === '::1' || /^127\./.test(hostname);

// -----------------------------------------------------------------------------------------------
// Printer

/** What the operator saw on the printed calibration sheet. */
export type PrintAnswer = 'matches' | 'off' | 'cropped' | 'nothing';

export type PrinterCode = 'ok' | 'off' | 'cropped' | 'nothing';

export function gradePrinter(answer: PrintAnswer): Finding<PrinterCode>[] {
  switch (answer) {
    case 'matches':
      return [{ status: 'pass', code: 'ok' }];
    case 'off':
      return [{ status: 'fail', code: 'off' }];
    case 'cropped':
      return [{ status: 'warn', code: 'cropped' }];
    case 'nothing':
      return [{ status: 'fail', code: 'nothing' }];
  }
}

// -----------------------------------------------------------------------------------------------
// Network and upload

/** Below this a 12 MB clip takes over a minute to reach the guest. */
export const SLOW_UPLOAD_MBPS = 2;

export type NetworkCode =
  | 'ok'
  | 'slow'
  | 'offline'
  | 'unauthorized'
  | 'storage_unavailable'
  | 'rate_limited'
  | 'put_failed'
  | 'incomplete'
  | 'failed';

export function gradeNetwork(
  input: { kind: 'ok'; mbps: number } | { kind: 'error'; code: Exclude<NetworkCode, 'ok' | 'slow'> },
): Finding<NetworkCode>[] {
  if (input.kind === 'error') return [{ status: input.code === 'rate_limited' ? 'warn' : 'fail', code: input.code }];
  const mbps = Math.round(input.mbps * 10) / 10;
  // How long a typical 12 MB clip (balanced, 15 s, 1080p) would take over this connection.
  const seconds = Math.max(1, Math.round((12 * 8) / Math.max(input.mbps, 0.01)));
  return input.mbps < SLOW_UPLOAD_MBPS
    ? [{ status: 'warn', code: 'slow', params: { mbps, seconds } }]
    : [{ status: 'pass', code: 'ok', params: { mbps, seconds } }];
}
