/**
 * The pure parts of the WASM H.264 encoder (the `wasm` rung): colour conversion, rate control and
 * the small fixes the encoder's MP4 needs before it is re-muxed. Kept free of the browser so every
 * one of them is tested in Node.
 */

// ---------------------------------------------------------------------------------------------
// RGBA → I420

/**
 * RGBA to planar YUV 4:2:0 (I420), BT.709, limited range ("TV levels"): the matrix browsers assume
 * for HD H.264 that carries no colour description, and the one the output is tagged with. Chroma is
 * the average of each 2×2 block. `width` and `height` must be even.
 */
export function rgbaToI420(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  if (width % 2 || height % 2) throw new RangeError('I420 needs even dimensions');
  if (rgba.length < width * height * 4) throw new RangeError('RGBA buffer is smaller than width × height × 4');
  const lumaSize = width * height;
  const out = new Uint8Array(lumaSize + lumaSize / 2);
  const uPlane = lumaSize;
  const vPlane = lumaSize + lumaSize / 4;
  const half = width / 2;
  for (let y = 0; y < height; y += 2) {
    const row0 = y * width * 4;
    const row1 = row0 + width * 4;
    for (let x = 0; x < width; x += 2) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let dy = 0; dy < 2; dy++) {
        const base = dy ? row1 : row0;
        for (let dx = 0; dx < 2; dx++) {
          const p = base + (x + dx) * 4;
          const r = rgba[p]!;
          const g = rgba[p + 1]!;
          const b = rgba[p + 2]!;
          out[(y + dy) * width + x + dx] = ((47 * r + 157 * g + 16 * b + 128) >> 8) + 16;
          sr += r;
          sg += g;
          sb += b;
        }
      }
      const c = (y >> 1) * half + (x >> 1);
      out[uPlane + c] = clampByte(((-26 * sr - 86 * sg + 112 * sb + 512) >> 10) + 128);
      out[vPlane + c] = clampByte(((112 * sr - 102 * sg - 10 * sb + 512) >> 10) + 128);
    }
  }
  return out;
}

const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---------------------------------------------------------------------------------------------
// Rate control

export const QP_MIN = 18;
export const QP_MAX = 46;

/**
 * A starting quantizer for a target bitrate. The encoder has no rate control worth relying on, so
 * the render drives the quantizer itself (`nextQp`); this only picks where to begin, from bits per
 * pixel: about QP 30 at the Balanced preset (0.085 bits/pixel), 6 steps (a halving of the rate)
 * per doubling.
 */
export function initialQp(bitrate: number, width: number, height: number, fps: number): number {
  const bpp = bitrate / (width * height * fps);
  return clamp(Math.round(30 - 6 * Math.log2(bpp / 0.085)), 22, 40);
}

/**
 * Steer the quantizer so the file lands near the target bitrate. `produced` is the encoded size so
 * far; it is compared with what the target allows for the frames done so far, over the whole video
 * (not per frame: key frames are far larger than the rest). Moves one or two steps, never more, so
 * the picture quality does not pump.
 */
export function nextQp(state: {
  qp: number;
  producedBytes: number;
  frames: number;
  fps: number;
  bitrate: number;
}): number {
  const { qp, producedBytes, frames, fps, bitrate } = state;
  // Too early to say (the first key frame alone is a large share of a short video).
  if (frames < Math.max(4, fps / 2) || producedBytes <= 0) return qp;
  const budget = ((bitrate / 8) * frames) / fps;
  const ratio = producedBytes / budget;
  const step = ratio > 1.4 ? 2 : ratio > 1.12 ? 1 : ratio < 0.65 ? -2 : ratio < 0.88 ? -1 : 0;
  return clamp(qp + step, QP_MIN, QP_MAX);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------------------------
// The encoder's MP4 → packets

/** Is any NAL unit of this length-prefixed (AVCC) sample an IDR slice? */
export function sampleIsKey(sample: Uint8Array, lengthSize = 4): boolean {
  let pos = 0;
  while (pos + lengthSize < sample.length) {
    let len = 0;
    for (let i = 0; i < lengthSize; i++) len = len * 256 + sample[pos + i]!;
    if (len <= 0) return false;
    if ((sample[pos + lengthSize]! & 0x1f) === 5) return true;
    pos += lengthSize + len;
  }
  return false;
}

/** H.264 Annex A, Table A-1: [level_idc, MaxMBPS, MaxFS]. */
const LEVELS: readonly [number, number, number][] = [
  [10, 1485, 99],
  [11, 3000, 396],
  [12, 6000, 396],
  [13, 11880, 396],
  [20, 11880, 396],
  [21, 19800, 792],
  [22, 20250, 1620],
  [30, 40500, 1620],
  [31, 108000, 3600],
  [32, 216000, 5120],
  [40, 245760, 8192],
  [41, 245760, 8192],
  [42, 522240, 8704],
  [50, 589824, 22080],
  [51, 983040, 36864],
  [52, 2073600, 36864],
];

/** The lowest H.264 level that allows this picture size at this frame rate. */
export function minAvcLevel(width: number, height: number, fps: number): number {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  for (const [level, maxMbps, maxFs] of LEVELS) if (mbs <= maxFs && mbs * fps <= maxMbps) return level;
  return 52;
}

/**
 * The encoder stamps a fixed, low level into its stream, whatever the picture size. Decoders with
 * hardware pipelines check the stated level against the size (and some refuse a mismatch), so the
 * decoder configuration (an `avcC` record) is rewritten to the level the picture needs. The level
 * is a plain byte in the record and again in the SPS inside it; nothing else changes.
 */
export function withMinimumLevel(avcc: Uint8Array, minLevel: number): Uint8Array {
  const out = avcc.slice();
  if (out.length < 8 || out[0] !== 1) return out;
  if (out[3]! < minLevel) out[3] = minLevel;
  const spsCount = out[5]! & 0x1f;
  let pos = 6;
  for (let i = 0; i < spsCount && pos + 2 <= out.length; i++) {
    const len = (out[pos]! << 8) | out[pos + 1]!;
    const sps = pos + 2;
    // NAL header, profile_idc, constraint flags, level_idc.
    if (len >= 4 && sps + 3 < out.length && out[sps + 3]! < minLevel) out[sps + 3] = minLevel;
    pos = sps + len;
  }
  return out;
}

/** The `avc1.PPCCLL` codec string of an `avcC` record. */
export function avcCodecString(avcc: Uint8Array): string {
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `avc1.${hex(avcc[1]!)}${hex(avcc[2]!)}${hex(avcc[3]!)}`;
}
