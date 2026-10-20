import { LoopingVideo } from './background-video';
import { SEGMENT_SIDE, type MaskSource } from './background-math';
import type { Compositor } from './gl/compositor';
import type { RenderBackground } from './render';

/** Frames in a row that fail to segment before the render stops trying (the rest goes out as filmed). */
const MAX_CONSECUTIVE_FAILURES = 5;

export type BackgroundOutcome = 'none' | 'applied' | 'unavailable';

/**
 * One render's background replacement (CAP-10): opens the segmenter, sets the backdrop on the compositor,
 * and for every footage frame, after it is composed and before it is finished, finds the person in it
 * (on the frame actually drawn, so slow-motion in-betweens are segmented as they are shown) and, for a
 * video background, brings in its frame.
 *
 * Failing to start is not a failed take: the video renders as filmed and the outcome says so.
 */
export class BackgroundRun {
  private failures = 0;
  private segmented = 0;
  private gaveUp = false;

  private constructor(
    private readonly compositor: Compositor,
    private readonly masker: MaskSource,
    private readonly video: LoopingVideo | null,
    private readonly fps: number,
  ) {}

  /** `run` is null when nothing is to be replaced (or it could not start); `outcome` tells which. */
  static async start(
    spec: RenderBackground | null | undefined,
    compositor: Compositor,
    opts: { segmenter?: () => Promise<MaskSource>; fps: number; frames: number },
  ): Promise<{ run: BackgroundRun | null; outcome: BackgroundOutcome }> {
    if (!spec) return { run: null, outcome: 'none' };
    let masker: MaskSource | null = null;
    let video: LoopingVideo | null = null;
    try {
      if (!opts.segmenter) throw new Error('this render has no segmenter');
      masker = await opts.segmenter();
      if (spec.kind === 'video') {
        video = await LoopingVideo.open(spec.file, opts.fps, opts.frames);
        compositor.setBackground({ kind: 'video' });
      } else if (spec.kind === 'image')
        compositor.setBackground({
          kind: 'image',
          image: spec.image,
          width: spec.image.width,
          height: spec.image.height,
        });
      else compositor.setBackground(spec);
      return { run: new BackgroundRun(compositor, masker, video, opts.fps), outcome: 'applied' };
    } catch (err) {
      console.warn('[render] background replacement unavailable', err);
      video?.dispose();
      masker?.close();
      compositor.setBackground(null);
      return { run: null, outcome: 'unavailable' };
    }
  }

  /** True if frames were replaced and the run did not give up part-way. */
  get ok() {
    return this.segmented > 0 && !this.gaveUp;
  }

  /** Call after composing footage frame `index` and before `compositor.finish()`. */
  async prepare(index: number): Promise<void> {
    if (this.gaveUp) return;
    if (this.video) {
      const sample = await this.video.next();
      if (sample) {
        const frame = sample.toVideoFrame();
        try {
          this.compositor.setBackgroundFrame(frame, this.video.geometry);
        } finally {
          frame.close();
          sample.close();
        }
      } // else: no frame for this instant, the previous one stays
    }
    const small = this.compositor.readForSegmentation(SEGMENT_SIDE);
    if (!small) return;
    try {
      const mask = await this.masker.mask(
        new ImageData(small.data, small.width, small.height),
        (index * 1000) / this.fps,
      );
      this.compositor.setMask(mask, { reset: index === 0 });
      this.failures = 0;
      this.segmented++;
    } catch (err) {
      // A frame the model cannot segment keeps the last mask; a model that keeps failing is given up on.
      if (++this.failures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn('[render] segmentation keeps failing, finishing without it', err);
        this.gaveUp = true;
        this.compositor.setMask(null);
      }
    }
  }

  /** The footage is over: intro/outro clips drawn after it must not be cut out with the last mask. */
  endFootage() {
    this.compositor.setMask(null);
  }

  stop() {
    this.video?.dispose();
    this.masker.close();
  }
}
