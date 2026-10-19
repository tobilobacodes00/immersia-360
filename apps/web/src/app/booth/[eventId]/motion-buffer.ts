/**
 * PHO-2: the photo booth's motion buffer. A rolling window of low-resolution frames from the live
 * camera, so a short clip can be cut around each shutter press (a second before, half a second
 * after) for the boomerang and short video, without recording video the whole time.
 *
 * Memory stays bounded: frames older than the window are closed as new ones arrive, and only the
 * frames of the clips being kept survive (handed to the caller, who must close or transfer them).
 */
export class MotionBuffer {
  private frames: { at: number; bmp: ImageBitmap }[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private collecting: { until: number; frames: ImageBitmap[]; done: (f: ImageBitmap[]) => void }[] = [];
  private busy = false;

  constructor(
    private readonly video: HTMLVideoElement,
    readonly fps = 12,
    private readonly maxSide = 720,
    private readonly keepMs = 1000,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.grab(), 1000 / this.fps);
  }

  private async grab() {
    const v = this.video;
    if (this.busy || v.readyState < 2 || !v.videoWidth) return;
    this.busy = true;
    try {
      const scale = Math.min(1, this.maxSide / Math.max(v.videoWidth, v.videoHeight));
      const bmp = await createImageBitmap(v, {
        resizeWidth: Math.round(v.videoWidth * scale),
        resizeHeight: Math.round(v.videoHeight * scale),
        resizeQuality: 'medium',
      });
      const now = performance.now();
      // A frame some pending clip still needs is shared with it; otherwise it lives in the window.
      let claimed = false;
      for (const c of this.collecting) {
        c.frames.push(claimed ? await createImageBitmap(bmp) : bmp);
        claimed = true;
      }
      for (const c of this.collecting.filter((c) => now >= c.until)) c.done(c.frames);
      this.collecting = this.collecting.filter((c) => now < c.until);
      if (!claimed) this.frames.push({ at: now, bmp });
      while (this.frames.length && now - this.frames[0]!.at > this.keepMs) this.frames.shift()!.bmp.close();
    } catch {
      // A frame that couldn't be grabbed (camera switching) is just skipped.
    } finally {
      this.busy = false;
    }
  }

  /**
   * The clip around "now": the buffered second before, plus `afterMs` more. The returned frames
   * belong to the caller.
   */
  clip(afterMs = 500): Promise<ImageBitmap[]> {
    const before = this.frames.map((f) => f.bmp);
    this.frames = [];
    return new Promise((resolve) => {
      this.collecting.push({ until: performance.now() + afterMs, frames: before, done: resolve });
    });
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const f of this.frames) f.bmp.close();
    this.frames = [];
    for (const c of this.collecting) c.done(c.frames);
    this.collecting = [];
  }
}
