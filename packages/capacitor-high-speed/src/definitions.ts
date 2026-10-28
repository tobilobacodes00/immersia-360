import type { PermissionState, PluginListenerHandle } from '@capacitor/core';

/**
 * The native high-speed recorder of the Immersia companion app (CAP-14). Browsers cannot record
 * 120-240 fps; the companion wraps the same booth web app and adds this plugin: a native camera
 * session that records a high-frame-rate movie file to the app's temporary storage, with its live
 * preview drawn behind a transparent WebView so the booth's web UI overlays it.
 *
 * Everything else (UI, take store, render, upload, share) stays in the web layer. The recording
 * reaches the web layer as a file URL (`Capacitor.convertFileSrc(path)`), never as base64.
 */

export type HighSpeedFacing = 'back' | 'front' | 'external';
export type HighSpeedLensKind = 'wide' | 'ultra-wide' | 'telephoto' | 'unknown';
export type HighSpeedCodec = 'h264' | 'hevc';

/** One way a lens can record at high speed. */
export interface HighSpeedFormat {
  width: number;
  height: number;
  /** Frames per second the recording runs at (120, 240, ...). */
  fps: number;
}

export interface HighSpeedLens {
  /** Opaque, stable id: `AVCaptureDevice.uniqueID` on iOS, the Camera2 id on Android. */
  id: string;
  /** The platform's own name for the lens. */
  label: string;
  facing: HighSpeedFacing;
  kind: HighSpeedLensKind;
  /** Every high-speed (120 fps and up) format this lens records, in no particular order. */
  formats: HighSpeedFormat[];
}

export interface HighSpeedCapabilities {
  /** At least one lens can record 120 fps or more. False on the web and on phones without it. */
  available: boolean;
  platform: 'ios' | 'android' | 'web';
  /** Container of the recordings: `video/quicktime` (iOS) or `video/mp4` (Android). Empty on the web. */
  mime: string;
  /** Codecs `startPreview({ codec })` may ask for. Android picks its own, so this is empty there. */
  codecs: HighSpeedCodec[];
  /** `startMotionSampling` works, so the booth's motion trigger can run on the native preview. */
  motionSampling: boolean;
  lenses: HighSpeedLens[];
}

export type HighSpeedPermissionType = 'camera' | 'microphone';

export interface HighSpeedPermissionStatus {
  camera: PermissionState;
  microphone: PermissionState;
}

export interface StartPreviewOptions {
  /** A lens id from `capabilities()`; null picks the best back lens. */
  lens: string | null;
  /** Frames per second to record at; the lens must have a format that does at least this. */
  fps: number;
  /** Wanted picture size; the closest format that reaches `fps` is used. */
  width: number;
  height: number;
  /** iOS only: the codec of the recording. Defaults to H.264, which every renderer decodes. */
  codec?: HighSpeedCodec;
  /** Mirror the on-screen preview only. Recordings are never mirrored. */
  mirror?: boolean;
  /** Record the microphone with the video. Asks for the permission when it is not granted yet. */
  audio?: boolean;
}

/** What the native session actually settled on. */
export interface PreviewInfo {
  lens: string;
  label: string;
  facing: HighSpeedFacing;
  kind: HighSpeedLensKind;
  width: number;
  height: number;
  fps: number;
  mime: string;
  codec: HighSpeedCodec | null;
  /** The recordings carry sound. */
  audio: boolean;
}

export interface StartRecordingOptions {
  /**
   * Names the file, so a crash leaves it findable by take id. The booth passes its take's id; without one the
   * plugin makes one up (it is in the result).
   */
  id?: string;
}

export interface RecordingResult {
  id: string;
  /** `file://` URI of the movie in the app's temporary storage; convert it with `Capacitor.convertFileSrc`. */
  path: string;
  mime: string;
  bytes: number;
  durationMs: number;
  width: number;
  height: number;
  /** The frame rate it was recorded at. */
  fps: number;
  codec: HighSpeedCodec | null;
  /** The recording ended before `stopRecording()` was called (an interruption or an error). */
  interrupted: boolean;
}

/** A movie the plugin still holds: left behind by a crash, or not yet deleted. */
export interface RecordingFile {
  id: string;
  path: string;
  bytes: number;
  modifiedMs: number;
}

export type HighSpeedErrorCode =
  | 'permission_denied'
  | 'no_high_speed_format'
  | 'lens_not_found'
  | 'unsupported'
  | 'not_previewing'
  | 'not_recording'
  | 'already_recording'
  | 'busy'
  | 'storage'
  | 'thermal'
  | 'interrupted'
  | 'recording_failed'
  | 'session_failed'
  | 'unknown';

export interface HighSpeedErrorEvent {
  code: HighSpeedErrorCode;
  message: string;
  /** The preview is gone: the web layer has to start it again. */
  fatal: boolean;
}

export type HighSpeedInterruptionReason = 'thermal' | 'call' | 'background' | 'other';

export interface HighSpeedInterruptionEvent {
  reason: HighSpeedInterruptionReason;
  /** `began` when the camera is taken away (or the phone gets too hot), `ended` when it is back. */
  state: 'began' | 'ended';
  /** A recording was running and has been ended (and its file finished) by this interruption. */
  recording: boolean;
}

/** One downsampled frame for the motion trigger: a GRID_W x GRID_H luma grid (see @immersia/capture). */
export interface HighSpeedMotionFrameEvent {
  /** Base64 of `width * height` luma bytes. */
  luma: string;
  width: number;
  height: number;
}

export interface HighSpeedPlugin {
  /** Lenses and the high-speed formats each can record. Cheap; safe to call again after permission. */
  capabilities(): Promise<HighSpeedCapabilities>;
  checkPermissions(): Promise<HighSpeedPermissionStatus>;
  requestPermissions(options?: { permissions?: HighSpeedPermissionType[] }): Promise<HighSpeedPermissionStatus>;

  /**
   * Open the lens at a format that reaches `fps` and draw its preview behind the (now transparent)
   * WebView. Replaces a preview that is already running. Rejects with `no_high_speed_format` when
   * the lens has no format that fast, `permission_denied` when the camera was refused.
   */
  startPreview(options: StartPreviewOptions): Promise<PreviewInfo>;
  setMirrored(options: { mirrored: boolean }): Promise<void>;
  /** Close the camera and give the WebView its background back. Safe to call when nothing runs. */
  stopPreview(): Promise<void>;

  /** Send `motionFrame` events (about ten a second) while the preview runs. */
  startMotionSampling(options?: { intervalMs?: number }): Promise<void>;
  stopMotionSampling(): Promise<void>;

  /** Resolves once the first frame is being written. */
  startRecording(options?: StartRecordingOptions): Promise<{ id: string }>;
  /**
   * Finish the movie. Also resolves (with `interrupted: true`) when an interruption already ended it,
   * so the web layer can always collect what was recorded.
   */
  stopRecording(): Promise<RecordingResult>;
  /** Delete a movie once the web layer has stored it. Resolves when it is gone or never existed. */
  deleteRecording(options: { id: string }): Promise<void>;
  listRecordings(): Promise<{ recordings: RecordingFile[] }>;

  addListener(eventName: 'error', listener: (event: HighSpeedErrorEvent) => void): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'interruption',
    listener: (event: HighSpeedInterruptionEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'motionFrame',
    listener: (event: HighSpeedMotionFrameEvent) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
