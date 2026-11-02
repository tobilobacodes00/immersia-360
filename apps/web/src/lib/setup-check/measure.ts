/**
 * Browser measurements for the setup check (HLP-1). Client-only; nothing here throws.
 */

/** Frames the browser actually presents from `video` over `durationMs`, as frames per second. */
export function measureFps(video: HTMLVideoElement, durationMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      let first: { at: number; frames: number } | null = null;
      let last = { at: 0, frames: 0 };
      let callbacks = 0;
      const deadline = performance.now() + durationMs;
      const onFrame: VideoFrameRequestCallback = (now, meta) => {
        callbacks++;
        // `presentedFrames` counts every frame the camera delivered; callbacks can coalesce on a slow display.
        const frames = meta.presentedFrames ?? callbacks;
        first ??= { at: now, frames };
        last = { at: now, frames };
        if (performance.now() < deadline) video.requestVideoFrameCallback(onFrame);
        else {
          const seconds = (last.at - first.at) / 1000;
          resolve(seconds > 0.5 && last.frames > first.frames ? (last.frames - first.frames) / seconds : null);
        }
      };
      video.requestVideoFrameCallback(onFrame);
      // A paused or hidden tab never presents a frame: give up rather than wait forever.
      setTimeout(() => resolve(null), durationMs + 3000);
      return;
    }
    const total = () => video.getVideoPlaybackQuality?.().totalVideoFrames;
    const before = total();
    if (before === undefined) return resolve(null);
    const start = performance.now();
    setTimeout(() => {
      const after = total();
      const seconds = (performance.now() - start) / 1000;
      resolve(after === undefined || seconds <= 0 ? null : (after - before) / seconds);
    }, durationMs);
  });
}

/** iPhone, iPad and iPadOS (which reports itself as a Mac with a touch screen). */
export function isAppleTouchDevice(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Running as an installed app (added to the Home Screen / installed from the browser). */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
