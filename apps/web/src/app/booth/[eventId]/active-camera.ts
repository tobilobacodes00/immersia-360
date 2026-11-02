import type { LensClass, OpenedCamera } from '@immersia/capture';
import { reconcileChoice, type CameraChoice } from './camera-choice';

/** What the settings drawer needs to know about the camera that is open. */
export interface ActiveCamera {
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
}

export function describeCamera(cam: OpenedCamera): ActiveCamera {
  return {
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
export function reconcileWithCamera(choice: CameraChoice, cam: OpenedCamera): CameraChoice {
  return reconcileChoice(choice, {
    torchSupported: cam.torch.supported,
    zoomSupported: cam.zoom.range !== null,
    applied: cam.applied,
  });
}
