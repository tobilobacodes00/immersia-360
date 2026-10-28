import type { LensClass, OpenedCamera, OpenedNativeCamera } from '@immersia/capture';
import { reconcileChoice, type CameraChoice } from './camera-choice';

/** A camera the booth has open: a browser camera or the simulator, or the companion's native one (CAP-14). */
export type AnyCamera = OpenedCamera | OpenedNativeCamera;

/** What the settings drawer needs to know about the camera that is open. */
export interface ActiveCamera {
  /** Whose picture this is: the browser's camera, the simulator, or the native high-speed camera. */
  kind: AnyCamera['kind'];
  deviceId: string | null;
  /** The mode the browser reports, kept for classifying the browser's list of cameras. */
  facingMode: string | null;
  label: string;
  width: number;
  height: number;
  frameRate: number;
  lens: LensClass;
  torch: OpenedCamera['torch'];
  zoom: OpenedCamera['zoom'];
  /** The zoom in effect when it opened. */
  zoomAtOpen: number | null;
  /** The motion trigger can read this camera's picture (the native camera may not offer it). */
  motion: boolean;
}

export function describeCamera(cam: AnyCamera): ActiveCamera {
  return {
    kind: cam.kind,
    deviceId: cam.settings.deviceId,
    facingMode: cam.settings.facingMode,
    label: cam.label,
    width: cam.settings.width,
    height: cam.settings.height,
    frameRate: cam.settings.frameRate,
    lens: cam.lens,
    torch: cam.torch,
    zoom: cam.zoom,
    zoomAtOpen: cam.applied.zoom,
    motion: cam.kind !== 'native-hfr' || cam.motion.supported,
  };
}

/**
 * The unit to show a zoom value in. Phone cameras report a multiplier (1 to 10, "2×"); UVC webcams in
 * Chrome on Windows and macOS report a percentage scale (100 to 500, where 100 is no zoom), which "×"
 * would turn into "300×".
 */
export function zoomUnit(range: { min: number; max: number }): '×' | '%' {
  return range.max <= 20 ? '×' : '%';
}

/** `choice` made to match what `cam` really did with its saved zoom and torch. */
export function reconcileWithCamera(
  choice: CameraChoice,
  cam: Pick<AnyCamera, 'torch' | 'zoom' | 'applied'>,
): CameraChoice {
  return reconcileChoice(choice, {
    torchSupported: cam.torch.supported,
    zoomSupported: cam.zoom.range !== null,
    applied: cam.applied,
  });
}
