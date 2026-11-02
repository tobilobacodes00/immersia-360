import {
  ALL_FORMATS,
  BufferSource,
  CustomVideoEncoder,
  EncodedPacket,
  EncodedPacketSink,
  Input,
  registerEncoder,
  type VideoCodec,
  type VideoSample,
} from 'mediabunny';
import { avcCodecString, minAvcLevel, rgbaToI420, sampleIsKey, withMinimumLevel } from './avc';

/**
 * The `wasm` rung of the render ladder: H.264 from a WebAssembly encoder (minih264, via the
 * `h264-mp4-encoder` package) for browsers whose WebCodecs has no H.264 encoder.
 *
 * It plugs into Mediabunny as a custom video encoder, so the render pipeline is the one the other
 * rungs run: the same WebGL2 compositor draws every frame, `CanvasSource` hands each frame to the
 * encoder, and Mediabunny muxes the packets (and the AAC audio) into the final MP4. The encoder
 * itself lives in a Worker of its own, so compositing the next frame overlaps encoding this one.
 *
 * That library only produces a finished MP4, not loose packets: the render side gets the file at the
 * end, reads the packets back out of it, and hands them to Mediabunny (the key-frame flags are
 * recomputed from the bitstream, because the library marks every sample as a sync sample, and the
 * level in the decoder configuration is raised to what the picture size needs).
 */

/** The encoder could not start, crashed, or produced something unusable. The ladder moves on. */
export class WasmEncoderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WasmEncoderError';
  }
}

export const isWasmEncoderError = (err: unknown): err is WasmEncoderError =>
  err instanceof Error && err.name === 'WasmEncoderError';

// ---------------------------------------------------------------------------------------------
// Where the encoder's worker script is served from

let workerFactory: (() => Worker) | null = null;

/**
 * Where to start the encoder's worker from. The default is `h264-encoder.js` beside the script that
 * is running (the app's `public/workers`, or the render worker's page), keeping that script's query
 * string so a new deploy busts the cache. Tests and unusual hosts can say otherwise.
 */
export function configureWasmEncoder(options: { createWorker: () => Worker }): void {
  workerFactory = options.createWorker;
}

function defaultWorker(): Worker {
  const here = new URL(self.location.href);
  return new Worker(new URL(`h264-encoder.js${here.search}`, here));
}

// ---------------------------------------------------------------------------------------------
// The Mediabunny encoder

type Reply =
  { type: 'ready' } | { type: 'ack' } | { type: 'done'; mp4: ArrayBuffer } | { type: 'error'; message: string };

/** Frames handed to the worker before waiting for it: enough to keep it busy, few enough to bound memory. */
const MAX_IN_FLIGHT = 2;
/** minih264's speed setting (0 = best quality, 10 = fastest): the middle, since this is a fallback. */
const ENCODER_SPEED = 5;
const START_TIMEOUT_MS = 30_000;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A failure nobody awaits (the render was cancelled) must not surface as an unhandled rejection.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** How many WASM renders are running: the encoder only claims H.264 while one is. */
let active = 0;
let registered = false;

class WasmH264Encoder extends CustomVideoEncoder {
  static override supports(codec: VideoCodec, config: VideoEncoderConfig): boolean {
    return active > 0 && codec === 'avc' && config.width % 2 === 0 && config.height % 2 === 0;
  }

  private worker: Worker | null = null;
  private ready = deferred<void>();
  private finished = deferred<ArrayBuffer>();
  private ackWaiters: Deferred<void>[] = [];
  private failure: Error | null = null;

  private width = 0;
  private height = 0;
  private fps = 30;
  private bitrate = 4_000_000;
  private inFlight = 0;
  /** Presentation times of the frames in, in order (there are no B-frames: output order is input order). */
  private timestamps: number[] = [];

  override async init(): Promise<void> {
    this.width = this.config.width;
    this.height = this.config.height;
    this.fps = Math.max(1, Math.round(this.config.framerate ?? 30));
    this.bitrate = this.config.bitrate ?? 4_000_000;
    let worker: Worker;
    try {
      worker = (workerFactory ?? defaultWorker)();
    } catch (cause) {
      throw new WasmEncoderError('Could not start the WASM encoder', { cause });
    }
    this.worker = worker;
    worker.onmessage = (e: MessageEvent<Reply>) => this.onReply(e.data);
    worker.onerror = (e) => this.fail(new WasmEncoderError(e.message || 'The WASM encoder worker failed'));
    worker.postMessage({
      type: 'init',
      width: this.width,
      height: this.height,
      fps: this.fps,
      // The encoder's own rate control does the steering: its settings cannot change once it has started.
      kbps: Math.max(1, Math.round(this.bitrate / 1000)),
      speed: ENCODER_SPEED,
      // Two seconds between key frames: the encoder is weak enough that a one-second GOP would cost
      // visible quality at the same bitrate.
      gop: this.fps * 2,
    });
    const timer = setTimeout(
      () => this.fail(new WasmEncoderError('The WASM encoder did not start in time')),
      START_TIMEOUT_MS,
    );
    try {
      await this.ready.promise;
    } finally {
      clearTimeout(timer);
    }
  }

  private onReply(m: Reply) {
    switch (m.type) {
      case 'ready':
        this.ready.resolve();
        break;
      case 'ack':
        this.inFlight--;
        this.wake();
        break;
      case 'done':
        this.finished.resolve(m.mp4);
        break;
      case 'error':
        this.fail(new WasmEncoderError(`The WASM encoder failed: ${m.message}`));
        break;
    }
  }

  private fail(err: Error) {
    if (this.failure) return;
    this.failure = err;
    this.ready.reject(err);
    this.finished.reject(err);
    for (const w of this.ackWaiters.splice(0)) w.reject(err);
    // Out of band when no encode() or flush() is waiting to throw it.
    if (typeof this.onError === 'function') this.onError(err);
  }

  private wake() {
    for (const w of this.ackWaiters.splice(0)) w.resolve();
  }

  private waitForAck(): Promise<void> {
    const d = deferred<void>();
    this.ackWaiters.push(d);
    return d.promise;
  }

  override async encode(sample: VideoSample): Promise<void> {
    if (this.failure) throw this.failure;
    if (sample.codedWidth !== this.width || sample.codedHeight !== this.height)
      throw new WasmEncoderError(
        `Frame is ${sample.codedWidth}×${sample.codedHeight}, the encoder was started for ${this.width}×${this.height}`,
      );
    while (this.inFlight >= MAX_IN_FLIGHT) {
      await this.waitForAck();
      if (this.failure) throw this.failure;
    }
    const rgba = new Uint8Array(sample.allocationSize({ format: 'RGBA' }));
    await sample.copyTo(rgba, { format: 'RGBA' });
    const i420 = rgbaToI420(rgba, this.width, this.height);
    this.timestamps.push(sample.timestamp);
    this.inFlight++;
    this.worker!.postMessage({ type: 'frame', i420: i420.buffer }, [i420.buffer]);
  }

  override async flush(): Promise<void> {
    try {
      while (this.inFlight > 0) {
        await this.waitForAck();
        if (this.failure) throw this.failure;
      }
      if (this.failure) throw this.failure;
      if (this.timestamps.length === 0) return;
      this.worker!.postMessage({ type: 'finish' });
      await this.emitPackets(new Uint8Array(await this.finished.promise));
    } catch (err) {
      // Mediabunny does not call close() after a failed flush: don't leave the worker running.
      this.close();
      throw err;
    }
  }

  /** Read the finished MP4's packets back out and hand them to Mediabunny. */
  private async emitPackets(mp4: Uint8Array) {
    const input = new Input({ source: new BufferSource(mp4), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      const config = await track?.getDecoderConfig();
      if (!track || !config?.description) throw new WasmEncoderError('The WASM encoder wrote no usable video');
      const raw = config.description;
      const avcc = withMinimumLevel(
        ArrayBuffer.isView(raw)
          ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
          : new Uint8Array(raw as ArrayBuffer),
        minAvcLevel(this.width, this.height, this.fps),
      );
      const decoderConfig: VideoDecoderConfig = {
        codec: avcCodecString(avcc),
        codedWidth: this.width,
        codedHeight: this.height,
        description: avcc,
        // What the converter in avc.ts produces, stated so players don't have to guess.
        colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
      };
      let i = 0;
      for await (const packet of new EncodedPacketSink(track).packets()) {
        const t = this.timestamps[i];
        if (t === undefined) throw new WasmEncoderError('The WASM encoder wrote more frames than it was given');
        const next = this.timestamps[i + 1];
        const duration = next !== undefined ? next - t : 1 / this.fps;
        const out = new EncodedPacket(packet.data, sampleIsKey(packet.data) ? 'key' : 'delta', t, duration);
        await this.onPacket(out, i === 0 ? { decoderConfig } : undefined);
        i++;
      }
      if (i !== this.timestamps.length)
        throw new WasmEncoderError(`The WASM encoder wrote ${i} frames for the ${this.timestamps.length} it was given`);
    } finally {
      input.dispose();
    }
  }

  override close(): void {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    worker.postMessage({ type: 'abort' });
    worker.terminate();
  }
}

/** Whether this host can run the encoder's worker at all (a cheap check; the real one is starting it). */
export function wasmEncoderSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
}

export type EncoderKind = 'native' | 'wasm';

/**
 * Run `fn` with H.264 encoding done by the WASM encoder (when `kind` is 'wasm') instead of the
 * browser's WebCodecs encoder. Everything Mediabunny encodes as AVC inside `fn` uses it; the browser's
 * own encoder is untouched outside. Renders on one device run one at a time, so a counter is
 * enough to keep overlapping callers from switching it off under each other.
 */
export async function withVideoEncoder<T>(kind: EncoderKind, fn: () => Promise<T>): Promise<T> {
  if (kind !== 'wasm') return fn();
  if (!wasmEncoderSupported()) throw new WasmEncoderError('This browser cannot run the WASM encoder');
  if (!registered) {
    registerEncoder(WasmH264Encoder);
    registered = true;
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
  }
}
