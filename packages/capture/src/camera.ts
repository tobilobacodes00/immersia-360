/**
 * Camera access (CAP-1, CAP-2, CAP-6, CAP-15). Everything returns a MediaStream so the same
 * recorder, preview and motion trigger work for a real camera, a capture card, or the simulator.
 */

export type Resolution = '720p' | '1080p' | '2160p';

export const RESOLUTION_SIZE: Record<Resolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '2160p': { width: 3840, height: 2160 },
};

export interface CameraInfo {
  deviceId: string;
  label: string;
  /** Lens role inferred from the label where the browser names it (CAP-2). */
  lens: 'wide' | 'ultrawide' | 'telephoto' | 'front' | 'unknown';
}

export interface OpenedCamera {
  kind: 'webcam' | 'simulator';
  label: string;
  stream: MediaStream;
  track: MediaStreamTrack;
  /** What the camera actually delivers (may be lower than requested). */
  settings: { width: number; height: number; frameRate: number; deviceId: string | null };
  torch: { supported: boolean; set: (on: boolean) => Promise<boolean> };
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

export function classifyLens(label: string): CameraInfo['lens'] {
  const l = label.toLowerCase();
  if (/front|user|facetime|selfie/.test(l)) return 'front';
  if (/ultra ?wide|ultrawide|0\.5/.test(l)) return 'ultrawide';
  if (/tele/.test(l)) return 'telephoto';
  if (/back|rear|environment|wide/.test(l)) return 'wide';
  return 'unknown';
}

/**
 * Cameras the browser exposes. Labels are empty until permission is granted, so callers should
 * list again after the first successful `openCamera`.
 */
export async function listCameras(): Promise<CameraInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}`, lens: classifyLens(d.label) }));
}

interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

export async function openCamera(opts: {
  deviceId?: string | null;
  resolution: Resolution;
  frameRate: number;
  /** CAP-15: off unless the event records live sound. */
  audio?: boolean;
  facingMode?: 'user' | 'environment';
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
  const s = track.getSettings();
  const caps = (track.getCapabilities?.() ?? {}) as TorchCapabilities;
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
    },
    torch: {
      supported: Boolean(caps.torch),
      set: async (on) => {
        if (!caps.torch) return false;
        try {
          await track.applyConstraints({ advanced: [{ torch: on } as unknown as MediaTrackConstraintSet] });
          return true;
        } catch {
          return false;
        }
      },
    },
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}
