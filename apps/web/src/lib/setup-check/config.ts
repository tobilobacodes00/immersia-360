import type { Resolution } from '@immersia/capture';
import type { RenderBackground } from '@immersia/render-engine';
import {
  type PRINT_SIZES,
  video360Schema,
  type Background,
  type BoothMode,
  type OutputSettings,
  type Video360Settings,
} from '@immersia/shared';

/**
 * What the setup check asks of the device for one booth of an event (HLP-1): the camera the booth
 * opens, and the render the device has to keep up with.
 */
export interface CheckPlan {
  mode: BoothMode;
  camera: { resolution: Resolution; frameRate: number; audio: boolean };
  /** The event's output preset for the render step. */
  render: Video360Settings;
  /** The photo booth's print job, for the printer step; null for the 360 booth, which does not print. */
  print: { size: (typeof PRINT_SIZES)[number]; twoUp: boolean; enabled: boolean } | null;
}

/**
 * The background (CAP-10) the test render replaces, so the measured speed includes finding the person in
 * every frame, which is most of its cost. A colour or a blur is used as the event has it. A picture or video
 * lives in the event's assets, which this page does not load, so a flat grey stands in for it: the same
 * person-finding work, without the cost of drawing the picture.
 */
export function testBackground(bg: Background): RenderBackground | null {
  if (!bg) return null;
  if ('color' in bg) return { kind: 'color', color: bg.color };
  if ('blur' in bg) return { kind: 'blur' };
  return { kind: 'color', color: '#808080' };
}

/**
 * The camera request mirrors the booth: the 360 booth opens the event's resolution, frame rate and
 * microphone (Booth360), the photo booth always 1080p at 30 fps without sound (PhotoBooth). A photo
 * event has no video preset of its own, but a device's render speed is a property of the device, so
 * it is measured with the standard 1080p, 30 fps vertical preset.
 */
export function planCheck(mode: BoothMode, output: OutputSettings): CheckPlan {
  if (mode === 'photo') {
    const p = output.photo;
    return {
      mode,
      camera: { resolution: '1080p', frameRate: 30, audio: false },
      render: video360Schema.parse({ resolution: '1080p', fps: 30, aspect: '9:16', quality: 'balanced' }),
      // The same rule the booth prints by (PhotoBooth): two strips on a 4×6 sheet, only for a 2×6 layout.
      print: { size: p.printSize, twoUp: p.print.doubleStrip && p.printSize === '2x6', enabled: p.print.enabled },
    };
  }
  const v = output.video360;
  return { mode, camera: { resolution: v.resolution, frameRate: v.fps, audio: v.microphone }, render: v, print: null };
}
