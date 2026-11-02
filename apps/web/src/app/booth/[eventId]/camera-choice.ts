/**
 * The operator's camera settings for this device (CAP-1, 2, 6): which camera, its zoom and light, the
 * on-screen mirror and the fill light. Kept in localStorage, so it outlives the page.
 */

export type FillLevel = 'off' | 'soft' | 'bright';
export type FillTint = 'neutral' | 'warm';

export interface FillLight {
  level: FillLevel;
  tint: FillTint;
}

export interface CameraChoice {
  /**
   * `camera`: a browser camera. `simulator`: no hardware. `native-hfr` (CAP-14): the companion app's native
   * 120-240 fps recorder; it exists only inside the companion, where `deviceId` is one of its lens ids.
   */
  source: 'camera' | 'simulator' | 'native-hfr';
  deviceId: string | null;
  /** Mirror the on-screen preview only (front cameras feel natural mirrored). */
  mirror: boolean;
  /** Zoom for this camera; absent means the camera's own default. */
  zoom?: number;
  /** The camera's own light, put back whenever the camera restarts. */
  torch?: boolean;
  /** An on-screen glow that lights guests' faces (front cameras). */
  fillLight?: FillLight;
  /** The frame rate asked of the native high-speed camera (120, 240); absent means the lens's best. */
  hfrFps?: number;
}

export const FILL_OFF: FillLight = { level: 'off', tint: 'neutral' };

/** Same key as ever: every field added since is optional, so older saved values stay valid as they are. */
export const CAMERA_CHOICE_KEY = 'immersia.booth.camera.v1';

export const FILL_LEVELS: readonly FillLevel[] = ['off', 'soft', 'bright'];
export const FILL_TINTS: readonly FillTint[] = ['neutral', 'warm'];

export const fillLightOf = (choice: CameraChoice): FillLight => choice.fillLight ?? FILL_OFF;

/**
 * A saved value, whatever shape and age it is, as a usable choice. Older versions saved only the
 * source, device and mirror; anything missing or malformed in the newer fields is dropped rather
 * than trusted, and an unusable value falls back to the default camera.
 */
export function parseCameraChoice(raw: string | null): CameraChoice {
  const fallback: CameraChoice = { source: 'camera', deviceId: null, mirror: false };
  let v: unknown;
  try {
    v = JSON.parse(raw ?? 'null');
  } catch {
    return fallback;
  }
  if (typeof v !== 'object' || v === null) return fallback;
  const o = v as Record<string, unknown>;
  if (o.source !== 'camera' && o.source !== 'simulator' && o.source !== 'native-hfr') return fallback;

  const choice: CameraChoice = {
    source: o.source,
    deviceId: typeof o.deviceId === 'string' && o.deviceId !== '' ? o.deviceId : null,
    mirror: o.mirror === true,
  };
  if (typeof o.zoom === 'number' && Number.isFinite(o.zoom) && o.zoom > 0) choice.zoom = o.zoom;
  if (o.torch === true) choice.torch = true;
  if (o.source === 'native-hfr' && typeof o.hfrFps === 'number' && Number.isInteger(o.hfrFps) && o.hfrFps >= 60) {
    choice.hfrFps = o.hfrFps;
  }
  const fill = o.fillLight;
  if (typeof fill === 'object' && fill !== null) {
    const { level, tint } = fill as Record<string, unknown>;
    choice.fillLight = {
      level: FILL_LEVELS.find((l) => l === level) ?? 'off',
      tint: FILL_TINTS.find((t) => t === tint) ?? 'neutral',
    };
  }
  return choice;
}

export function readCameraChoice(): CameraChoice {
  try {
    return parseCameraChoice(localStorage.getItem(CAMERA_CHOICE_KEY));
  } catch {
    // Storage unavailable: the default applies for this session.
    return parseCameraChoice(null);
  }
}

export function saveCameraChoice(c: CameraChoice) {
  try {
    localStorage.setItem(CAMERA_CHOICE_KEY, JSON.stringify(c));
  } catch {
    // The choice still applies for this session.
  }
}

/**
 * Whether going from one choice to another needs the camera reopened. Only a different camera does (or,
 * for the native high-speed camera, a different frame rate): zoom and the light are set on the live track,
 * and the mirror and fill light are only on screen.
 */
export function needsReopen(prev: CameraChoice, next: CameraChoice): boolean {
  return prev.source !== next.source || prev.deviceId !== next.deviceId || prev.hfrFps !== next.hfrFps;
}

/**
 * The choice to open a camera with where the native high-speed camera may not exist: a saved `native-hfr`
 * choice outside the companion (or on a phone with no high-speed lens) becomes the default browser camera,
 * since a native lens id means nothing to the browser.
 */
export function usableChoice(choice: CameraChoice, nativeAvailable: boolean): CameraChoice {
  if (choice.source !== 'native-hfr' || nativeAvailable) return choice;
  return { ...choice, source: 'camera', deviceId: null };
}

/** The change for picking a different camera: it has its own zoom range, so zoom starts over. */
export function switchCamera(camera: Pick<CameraChoice, 'source' | 'deviceId'>): Partial<CameraChoice> {
  return { ...camera, zoom: undefined };
}

/**
 * `prev` with `patch` applied. A setting patched to undefined (or a torch to off) is cleared rather
 * than kept as a value, so what is saved stays as small as what is set.
 */
export function applyChoice(prev: CameraChoice, patch: Partial<CameraChoice>): CameraChoice {
  const next = { ...prev, ...patch };
  if (next.zoom === undefined) delete next.zoom;
  if (!next.torch) delete next.torch;
  if (next.fillLight === undefined) delete next.fillLight;
  // A frame rate belongs to the native camera: switching to another camera clears it.
  if (next.hfrFps === undefined || next.source !== 'native-hfr') delete next.hfrFps;
  return next;
}

/**
 * The saved choice made to match what the camera really did once it opened: a torch it supports but
 * wouldn't switch on, or a zoom it clamped, would otherwise be shown as set when it is not. Returns
 * `choice` itself when nothing changed.
 */
export function reconcileChoice(
  choice: CameraChoice,
  cam: { torchSupported: boolean; zoomSupported: boolean; applied: { zoom: number | null; torch: boolean } },
): CameraChoice {
  let next = choice;
  if (choice.torch && cam.torchSupported && !cam.applied.torch) {
    const { torch: _torch, ...rest } = next;
    next = rest;
  }
  if (choice.zoom !== undefined && cam.zoomSupported && Math.abs((cam.applied.zoom ?? 0) - choice.zoom) > 0.005) {
    const { zoom: _zoom, ...rest } = next;
    next = cam.applied.zoom === null ? rest : { ...rest, zoom: cam.applied.zoom };
  }
  return next;
}
