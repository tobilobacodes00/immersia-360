/**
 * Output geometry and bitrate (VID-8, VID-10). Pure functions, shared by the booth (to plan a
 * render and mix music to fit) and the renderer.
 */

export type Resolution = '720p' | '1080p' | '2160p';
export type Aspect = '9:16' | '1:1' | '16:9';
export type QualityPreset = 'small' | 'balanced' | 'original';

const SHORT_SIDE: Record<Resolution, number> = { '720p': 720, '1080p': 1080, '2160p': 2160 };

export function outputSize(resolution: Resolution, aspect: Aspect): { width: number; height: number } {
  const s = SHORT_SIDE[resolution];
  const l = Math.round((s * 16) / 9);
  switch (aspect) {
    case '9:16':
      return { width: s, height: l };
    case '16:9':
      return { width: l, height: s };
    case '1:1':
      return { width: s, height: s };
  }
}

/**
 * Bits per pixel per frame. Balanced is tuned to the PRD's "~8–12 MB per 15 s 1080p clip"
 * (≈5.3 Mbit/s at 1080×1920, 30 fps); Original is "maximum bitrate" for the operator's archive.
 */
const BPP: Record<QualityPreset, number> = { small: 0.045, balanced: 0.085, original: 0.25 };

export function videoBitrate(preset: QualityPreset, width: number, height: number, fps: number): number {
  return Math.round(Math.min(50_000_000, Math.max(1_500_000, width * height * fps * BPP[preset])));
}

/** The lighter copy for messaging apps (DL-8): 720p-class at Small. */
export function messagingSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, 720 / Math.min(width, height));
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(width * scale), height: even(height * scale) };
}

export const AUDIO_BITRATE = 128_000;

/** Expected file size, for the setup screen's hint and storage planning. */
export function estimateBytes(preset: QualityPreset, width: number, height: number, fps: number, seconds: number) {
  return Math.round(((videoBitrate(preset, width, height, fps) + AUDIO_BITRATE) * seconds) / 8);
}
