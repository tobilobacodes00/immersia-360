/**
 * What the lens and light helpers need from a video track. Structural, so tests can pass plain
 * objects; `getCapabilities` and `getSettings` are optional because older Safari lacks them.
 */
export type ConstrainableTrack = Pick<MediaStreamTrack, 'applyConstraints'> &
  Partial<Pick<MediaStreamTrack, 'getCapabilities' | 'getSettings'>>;

interface Range {
  min?: number;
  max?: number;
  step?: number;
}

/** Zoom and torch come from the Image Capture spec; lib.dom does not type them on tracks. */
export interface ExtendedCapabilities extends MediaTrackCapabilities {
  zoom?: Range;
  torch?: boolean;
}

export interface ExtendedSettings extends MediaTrackSettings {
  zoom?: number;
  torch?: boolean;
}

/** The track's capabilities, or an empty object where the browser has none (never throws). */
export function capabilitiesOf(track: ConstrainableTrack): ExtendedCapabilities {
  try {
    return (track.getCapabilities?.() ?? {}) as ExtendedCapabilities;
  } catch {
    return {};
  }
}

/** The track's current settings, or an empty object where the browser has none (never throws). */
export function settingsOf(track: ConstrainableTrack): ExtendedSettings {
  try {
    return (track.getSettings?.() ?? {}) as ExtendedSettings;
  } catch {
    return {};
  }
}

/**
 * Apply one device-level setting (`zoom`, `torch`). Browsers take these only inside `advanced`,
 * and lib.dom does not know the keys, hence the cast.
 */
export function applyAdvanced(track: ConstrainableTrack, set: Record<string, number | boolean>): Promise<void> {
  return track.applyConstraints({ advanced: [set as unknown as MediaTrackConstraintSet] });
}
