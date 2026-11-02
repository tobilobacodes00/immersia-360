/**
 * The pure parts of the WASM H.264 encoder (the `wasm` rung): colour conversion and
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
