import { describe, expect, it } from 'vitest';
import { avcCodecString, minAvcLevel, rgbaToI420, sampleIsKey, withMinimumLevel } from '../src/wasm/avc';

/** A w×h RGBA image of one colour. */
const solid = (w: number, h: number, [r, g, b]: [number, number, number]) => {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([r, g, b, 255], i * 4);
  return px;
};

describe('RGBA → I420 (BT.709, limited range)', () => {
  it('lays out Y, then U, then V, at 4:2:0', () => {
    const out = rgbaToI420(solid(4, 2, [255, 255, 255]), 4, 2);
    expect(out).toHaveLength(4 * 2 * 1.5);
  });

  it('maps white, black and mid grey to the limited-range levels, with neutral chroma', () => {
    expect([...rgbaToI420(solid(2, 2, [255, 255, 255]), 2, 2)]).toEqual([235, 235, 235, 235, 128, 128]);
    expect([...rgbaToI420(solid(2, 2, [0, 0, 0]), 2, 2)]).toEqual([16, 16, 16, 16, 128, 128]);
    const grey = rgbaToI420(solid(2, 2, [128, 128, 128]), 2, 2);
    expect(grey[4]).toBe(128);
    expect(grey[5]).toBe(128);
    expect(Math.abs(grey[0]! - 126)).toBeLessThanOrEqual(1); // 16 + 219 × 128/255
  });

  it('uses the BT.709 matrix: pure red lands where an HD decoder expects it', () => {
    const [y, , , , u, v] = rgbaToI420(solid(2, 2, [255, 0, 0]), 2, 2);
    expect(y).toBe(63); // 16 + 219 × 0.2126
    expect(u).toBe(102);
    expect(v).toBe(240);
  });

  it('averages chroma over each 2×2 block and keeps luma per pixel', () => {
    // Left column white, right column black: chroma is neutral either way, luma differs per pixel.
    const px = new Uint8Array(2 * 2 * 4);
    px.set([255, 255, 255, 255], 0);
    px.set([0, 0, 0, 255], 4);
    px.set([255, 255, 255, 255], 8);
    px.set([0, 0, 0, 255], 12);
    expect([...rgbaToI420(px, 2, 2)]).toEqual([235, 16, 235, 16, 128, 128]);
  });

  it('refuses odd sizes and short buffers', () => {
    expect(() => rgbaToI420(new Uint8Array(3 * 2 * 4), 3, 2)).toThrow(RangeError);
    expect(() => rgbaToI420(new Uint8Array(4), 2, 2)).toThrow(RangeError);
  });
});

describe('the encoder’s MP4', () => {
  const nal = (type: number, size = 5) => {
    const body = new Uint8Array(size).fill(0xaa);
    body[0] = type; // forbidden_zero_bit=0, nal_ref_idc=0, nal_unit_type
    const out = new Uint8Array(4 + size);
    new DataView(out.buffer).setUint32(0, size);
    out.set(body, 4);
    return out;
  };
  const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };

  it('finds key frames from the bitstream (the library flags every sample as a sync sample)', () => {
    expect(sampleIsKey(nal(0x65))).toBe(true); // IDR slice
    expect(sampleIsKey(nal(0x61))).toBe(false); // non-IDR slice
    expect(sampleIsKey(concat(nal(0x06), nal(0x65)))).toBe(true); // SEI, then IDR
    expect(sampleIsKey(concat(nal(0x61), nal(0x61)))).toBe(false);
    expect(sampleIsKey(new Uint8Array(0))).toBe(false);
    expect(sampleIsKey(new Uint8Array([0, 0, 0, 0, 0x65]))).toBe(false); // a zero length is damage, not a key frame
  });

  it('picks the lowest H.264 level the picture and frame rate need', () => {
    expect(minAvcLevel(720, 1280, 30)).toBe(31);
    expect(minAvcLevel(1080, 1920, 30)).toBe(40);
    expect(minAvcLevel(1080, 1920, 60)).toBe(42);
    expect(minAvcLevel(1920, 1080, 60)).toBe(42);
    expect(minAvcLevel(2160, 3840, 30)).toBe(51);
    expect(minAvcLevel(176, 144, 15)).toBe(10);
    expect(minAvcLevel(176, 144, 30)).toBe(11);
  });

  // An avcC record with one 8-byte SPS (level 3.0) and one PPS.
  const avcc = (level: number) =>
    new Uint8Array([1, 66, 0xc0, level, 0xff, 0xe1, 0, 8, 0x67, 66, 0xc0, level, 1, 2, 3, 4, 1, 0, 2, 0x68, 0xce]);

  it('raises the level in the record and in its SPS, and nothing else', () => {
    const original = avcc(30);
    const raised = withMinimumLevel(original, 42);
    expect(raised[3]).toBe(42);
    expect(raised[11]).toBe(42); // the SPS's level_idc
    expect([...raised.slice(0, 3)]).toEqual([1, 66, 0xc0]);
    expect([...raised.slice(12)]).toEqual([...original.slice(12)]);
    expect(original[3]).toBe(30); // the input is not modified
  });

  it('never lowers a level that is already high enough, and leaves unknown records alone', () => {
    expect(withMinimumLevel(avcc(51), 40)[3]).toBe(51);
    const odd = new Uint8Array([2, 1, 2, 3]);
    expect([...withMinimumLevel(odd, 40)]).toEqual([2, 1, 2, 3]);
  });

  it('writes the codec string from the record', () => {
    expect(avcCodecString(avcc(42))).toBe('avc1.42c02a');
  });
});
