/**
 * Render speed for the setup check (HLP-1): the test take is rendered for real, then the measured
 * cost is scaled to the PRD's reference clip so every device lands on one scale and can be graded
 * against the 45 s / 90 s targets.
 *
 * Rendering cost is close to linear in the number of pixels pushed through decode, composite and
 * encode, so the unit is "milliseconds per megapixel-frame". The test clip pays a fixed start-up
 * cost (worker, shader compile, decoder) that a long clip spreads thinner, so the estimate leans
 * slow rather than fast: a pass is a real pass.
 */
import type { Video360Settings } from '@immersia/shared';

export interface ClipSpec {
  seconds: number;
  fps: number;
  width: number;
  height: number;
}

/** The PRD's yardstick: a 15 s 1080p clip (vertical, 30 fps). */
export const REFERENCE_CLIP: ClipSpec = { seconds: 15, fps: 30, width: 1080, height: 1920 };

/** Length of the recorded test take. Long enough for slow motion and a steady frame rate. */
export const TEST_TAKE_SECONDS = 4;

export interface RenderMeasurement {
  /** From the render result: wall time of the render itself, paused time excluded. */
  renderMs: number;
  /** Output frames written. */
  frames: number;
  width: number;
  height: number;
}

const megapixels = (width: number, height: number) => (width * height) / 1_000_000;

/** Cost of one megapixel of output frame, or null when the measurement can't support an estimate. */
export function msPerMegapixelFrame(m: RenderMeasurement): number | null {
  const work = m.frames * megapixels(m.width, m.height);
  if (!(m.renderMs > 0) || !(work > 0) || !Number.isFinite(m.renderMs)) return null;
  return m.renderMs / work;
}

/** How long `clip` would take at the measured speed, in milliseconds; null without a usable measurement. */
export function estimateClipMs(m: RenderMeasurement, clip: ClipSpec): number | null {
  const rate = msPerMegapixelFrame(m);
  if (rate === null) return null;
  return Math.round(rate * clip.seconds * clip.fps * megapixels(clip.width, clip.height));
}

/** The slow-motion segment of the event, fitted inside the short test take (the middle half). */
export function testSlowMotion(
  slowMotion: Video360Settings['slowMotion'],
  takeSeconds: number,
): Video360Settings['slowMotion'] {
  return { ...slowMotion, startS: round1(takeSeconds * 0.25), endS: round1(takeSeconds * 0.75) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "12.3 s" style figure for the screen; whole seconds from ten up. */
export function formatSeconds(ms: number): number {
  const s = ms / 1000;
  return s >= 10 ? Math.round(s) : round1(s);
}
