/**
 * Take recording. MediaRecorder emits a chunk every `timesliceMs`; each chunk is handed to `onChunk`
 * (which appends it to on-device storage) strictly in order, so a crash or reload loses at most the
 * last second of a take (NFR Reliability: zero clip loss).
 */

/**
 * Raw-take containers, best first. WebM comes first because it streams genuinely incremental chunks:
 * Chrome's MP4 recorder ignores the timeslice and only emits at fragment (keyframe) boundaries,
 * seconds apart, so a crash could lose several seconds. Raw takes never leave the device (the
 * renderer reads either container); the guest's file is always MP4/H.264. MP4 remains the fallback
 * for Safari versions without WebM recording.
 *
 * Within WebM, H.264 first: nearly every device encodes it in hardware, so recording a 1080p60 spin
 * costs little CPU (VP9 is usually software-encoded) and the renderer decodes it in hardware too.
 */
export const RECORDING_MIME_CANDIDATES = [
  'video/webm;codecs=h264',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.4d0028',
  'video/mp4;codecs=avc1',
  'video/mp4',
] as const;

export function pickRecordingMime(isSupported: (mime: string) => boolean): string | null {
  for (const mime of RECORDING_MIME_CANDIDATES) if (isSupported(mime)) return mime;
  return null;
}

/** Original-quality bitrate for the raw take: generous, because renders start from it. */
export function recordingBitrate(width: number, height: number, frameRate: number): number {
  const pixels = width * height;
  const perPixelPerFrame = 0.12; // ≈ 15 Mbit/s at 1080p60
  return Math.round(Math.min(60_000_000, Math.max(4_000_000, pixels * frameRate * perPixelPerFrame)));
}

export const extensionFor = (mime: string) => (mime.startsWith('video/mp4') ? 'mp4' : 'webm');

export interface RecordingResult {
  mimeType: string;
  durationMs: number;
  bytes: number;
  chunks: number;
}

export interface TakeRecorderOptions {
  mimeType: string;
  videoBitsPerSecond: number;
  timesliceMs?: number;
  /** Persist one chunk; must resolve only once the bytes are durable. */
  onChunk: (chunk: Blob, index: number) => Promise<void>;
  onError?: (err: unknown) => void;
}

export class TakeRecorder {
  private recorder: MediaRecorder;
  private queue: Promise<void> = Promise.resolve();
  private index = 0;
  private bytes = 0;
  private startedAt = 0;
  private stopped: Promise<RecordingResult> | null = null;
  private writeError: unknown = null;

  constructor(
    stream: MediaStream,
    private readonly opts: TakeRecorderOptions,
  ) {
    this.recorder = new MediaRecorder(stream, {
      mimeType: opts.mimeType,
      videoBitsPerSecond: opts.videoBitsPerSecond,
      audioBitsPerSecond: 128_000,
      // Chromium: a keyframe per chunk, so even MP4 fragments flush every timeslice. Ignored elsewhere.
      videoKeyFrameIntervalDuration: opts.timesliceMs ?? 1000,
    } as MediaRecorderOptions);
    this.recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      const chunk = e.data;
      const i = this.index++;
      this.bytes += chunk.size;
      this.queue = this.queue.then(() =>
        opts.onChunk(chunk, i).catch((err) => {
          // Keep recording (the camera is still live); surface the failure so the booth can warn.
          this.writeError ??= err;
          opts.onError?.(err);
        }),
      );
    };
    this.recorder.onerror = (e) => opts.onError?.((e as Event & { error?: unknown }).error ?? e);
  }

  get state(): RecordingState {
    return this.recorder.state;
  }

  get elapsedMs(): number {
    return this.startedAt ? performance.now() - this.startedAt : 0;
  }

  start(): void {
    this.startedAt = performance.now();
    this.recorder.start(this.opts.timesliceMs ?? 1000);
  }

  /** Stop and wait until every chunk has been persisted. Safe to call more than once. */
  stop(): Promise<RecordingResult> {
    this.stopped ??= new Promise<RecordingResult>((resolve, reject) => {
      const finish = () => {
        const durationMs = Math.round(performance.now() - this.startedAt);
        this.queue.then(() => {
          if (this.writeError) reject(this.writeError);
          else
            resolve({
              mimeType: this.recorder.mimeType || this.opts.mimeType,
              durationMs,
              bytes: this.bytes,
              chunks: this.index,
            });
        }, reject);
      };
      if (this.recorder.state === 'inactive') return finish();
      this.recorder.addEventListener('stop', finish, { once: true });
      this.recorder.stop();
    });
    return this.stopped;
  }
}
