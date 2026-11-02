/* global HME */
/**
 * The WASM encoder's worker. This file is a classic (non-module) worker script: the build puts the
 * `h264-mp4-encoder` web bundle (which defines `HME`) in front of it (see scripts/h264-worker.mjs)
 * and serves the result as `h264-encoder.js`, next to the app's own workers.
 *
 * Protocol (everything is request → reply, one frame in flight per ack):
 *   init   { width, height, fps, kbps, speed, gop }  → ready
 *   frame  { i420: ArrayBuffer }                    → ack
 *   finish {}                                       → done { mp4: ArrayBuffer }
 *   abort  {}                                       → (frees the encoder)
 * Any failure replies `error { message }`.
 *
 * The library freezes every setting at `initialize()` (setting one afterwards aborts the whole
 * WebAssembly module), so the bitrate is handed over once, up front, and the encoder's own rate
 * control steers the quantizer from frame to frame.
 */
let enc = null;
/** True from `initialize()` until `finalize()`: the library aborts if it is deleted in between. */
let open = false;
let file = 'out.mp4';

const describe = (err) =>
  typeof err === 'number' ? `native error ${err}` : String((err && err.message) || err || 'unknown error');

function free() {
  if (!enc) return;
  try {
    // An encoder that was never finalized (a cancelled or failed render) must be, before it is deleted.
    if (open) enc.finalize();
  } catch {
    // The module may already be dead; the worker is about to be discarded either way.
  }
  open = false;
  try {
    enc.delete();
  } catch {
    // Already freed by finalize.
  }
  enc = null;
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      free();
      enc = await HME.createH264MP4Encoder();
      enc.outputFilename = file;
      enc.width = m.width;
      enc.height = m.height;
      enc.frameRate = m.fps;
      enc.speed = m.speed;
      enc.groupOfPictures = m.gop;
      // Rate-controlled mode: with a bitrate set, the library ignores its fixed quantizer and picks one
      // per frame (between 10 and 50) to land near this many kilobits per second.
      enc.kbps = m.kbps;
      enc.temporalDenoise = false;
      enc.initialize();
      open = true;
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'frame') {
      if (!enc) throw new Error('encoder is not initialised');
      enc.addFrameYuv(new Uint8Array(m.i420));
      self.postMessage({ type: 'ack' });
    } else if (m.type === 'finish') {
      if (!enc) throw new Error('encoder is not initialised');
      enc.finalize();
      open = false;
      const mp4 = enc.FS.readFile(file).slice();
      try {
        enc.FS.unlink(file);
      } catch {
        // The file system is shared between encoders; a missing file is fine.
      }
      free();
      self.postMessage({ type: 'done', mp4: mp4.buffer }, [mp4.buffer]);
    } else if (m.type === 'abort') {
      free();
    }
  } catch (err) {
    free();
    self.postMessage({ type: 'error', message: describe(err) });
  }
};
