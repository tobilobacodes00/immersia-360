/**
 * Camera access (CAP-1, CAP-2, CAP-6, CAP-15). Everything returns a MediaStream so the same
 * recorder, preview and motion trigger work for a real camera, a capture card, or the simulator.
 * Which lenses exist is in `lenses.ts`; the camera's light is in `light.ts`.
 */
import { classifyLens, latestWins, setZoom, zoomRange, type LensClass, type ZoomRange } from './lenses';
import { setTorch, torchSupported, type TorchResult } from './light';
import { capabilitiesOf, settingsOf } from './track';

export type Resolution = '720p' | '1080p' | '2160p';

export const RESOLUTION_SIZE: Record<Resolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '2160p': { width: 3840, height: 2160 },
};

export interface OpenedCamera {
  kind: 'webcam' | 'simulator';
  label: string;
  stream: MediaStream;
  track: MediaStreamTrack;
  /** What the camera actually delivers (may be lower than requested). */
  settings: { width: number; height: number; frameRate: number; deviceId: string | null; facingMode: string | null };
  /** Which way it faces and which lens it is (CAP-2), from its label and facing mode. */
  lens: LensClass;
  /** CAP-6: the camera's own light, where it has one. */
  torch: { supported: boolean; set: (on: boolean) => Promise<TorchResult> };
  /** Zoom, where the browser offers it; `set` keeps only the newest of calls made in quick succession. */
  zoom: { range: ZoomRange | null; set: (value: number) => Promise<number | null> };
  /** What is in effect once the saved zoom and torch were re-applied at open. */
  applied: { zoom: number | null; torch: boolean };
  stop: () => void;
}

export class CameraError extends Error {
  constructor(
    readonly code: 'permission' | 'not_found' | 'in_use' | 'overconstrained' | 'insecure' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

/** Map browser exceptions to codes the UI can explain in the operator's language. */
export function toCameraError(err: unknown): CameraError {
  if (err instanceof CameraError) return err;
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? String(err);
  if (name === 'NotAllowedError' || name === 'SecurityError') return new CameraError('permission', message);
  if (name === 'NotFoundError' || (name === 'OverconstrainedError' && /deviceId/i.test(message)))
    return new CameraError('not_found', message);
  if (name === 'NotReadableError' || name === 'AbortError') return new CameraError('in_use', message);
  if (name === 'OverconstrainedError') return new CameraError('overconstrained', message);
  return new CameraError('unknown', message);
}

export async function openCamera(opts: {
  deviceId?: string | null;
  resolution: Resolution;
  frameRate: number;
  /** CAP-15: off unless the event records live sound. */
  audio?: boolean;
  facingMode?: 'user' | 'environment';
  /**
   * Zoom and torch to put back as soon as the camera is open: closing a camera resets both, so a
   * restart (lens change, retry after an error) would otherwise lose the operator's choice.
   * What took effect is in `applied`; a camera that can't do either simply ignores it.
   */
  restore?: { zoom?: number | null; torch?: boolean };
}): Promise<OpenedCamera> {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    throw new CameraError('insecure', 'Camera needs HTTPS');
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('not_found', 'No camera API in this browser');
  const size = RESOLUTION_SIZE[opts.resolution];
  const video: MediaTrackConstraints = {
    width: { ideal: size.width },
    height: { ideal: size.height },
    frameRate: { ideal: opts.frameRate, max: Math.max(opts.frameRate, 60) },
    ...(opts.deviceId
      ? { deviceId: { exact: opts.deviceId } }
      : { facingMode: { ideal: opts.facingMode ?? 'environment' } }),
  };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: opts.audio ?? false });
  } catch (err) {
    throw toCameraError(err);
  }
  const track = stream.getVideoTracks()[0];
  if (!track) throw new CameraError('not_found', 'No video track');

  const range = zoomRange(track);
  const wantZoom = opts.restore?.zoom;
  if (range && typeof wantZoom === 'number') await setZoom(track, wantZoom);
  const torchOn = opts.restore?.torch === true && torchSupported(track) && (await setTorch(track, true)).ok;

  const s = settingsOf(track);
  const facingMode = s.facingMode ?? capabilitiesOf(track).facingMode?.[0] ?? null;
  return {
    kind: 'webcam',
    label: track.label || 'Camera',
    stream,
    track,
    settings: {
      width: s.width ?? size.width,
      height: s.height ?? size.height,
      frameRate: Math.round(s.frameRate ?? opts.frameRate),
      deviceId: s.deviceId ?? opts.deviceId ?? null,
      facingMode,
    },
    lens: classifyLens(track.label, facingMode),
    torch: { supported: torchSupported(track), set: (on) => setTorch(track, on) },
    zoom: { range, set: latestWins((value: number) => setZoom(track, value)) },
    applied: { zoom: typeof s.zoom === 'number' ? s.zoom : null, torch: torchOn },
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}
