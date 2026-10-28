/* global HME */
/**
 * The WASM encoder's worker. This file is a classic (non-module) worker script: the build puts the
 * `h264-mp4-encoder` web bundle (which defines `HME`) in front of it (see scripts/h264-worker.mjs)
 * and serves the result as `h264-encoder.js`, next to the app's own workers.
 *
 * Protocol (everything is request → reply, one frame in flight per ack):
 *   init   { width, height, fps, qp, speed, gop }  → ready
 *   frame  { i420: ArrayBuffer, qp }               → ack { bytes }   (bytes: the MP4 written so far)
 *   finish {}                                      → done { mp4: ArrayBuffer }
 *   abort  {}                                      → (frees the encoder)
 * Any failure replies `error { message }`.
 */
let enc = null;
let file = 'out.mp4';

const describe = (err) =>
  typeof err === 'number' ? `native error ${err}` : String((err && err.message) || err || 'unknown error');

function free() {
  if (!enc) return;
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
      enc.quantizationParameter = m.qp;
      enc.groupOfPictures = m.gop;
      // Fixed-quantizer mode: the render steers the quantizer from the sizes reported by `ack`.
      enc.kbps = 0;
      enc.temporalDenoise = false;
      enc.initialize();
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'frame') {
      if (!enc) throw new Error('encoder is not initialised');
      enc.quantizationParameter = m.qp;
      enc.addFrameYuv(new Uint8Array(m.i420));
      let bytes = 0;
      try {
        bytes = enc.FS.stat(file).size;
      } catch {
        // No size to report: the render keeps its quantizer.
      }
      self.postMessage({ type: 'ack', bytes });
    } else if (m.type === 'finish') {
      if (!enc) throw new Error('encoder is not initialised');
      enc.finalize();
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
