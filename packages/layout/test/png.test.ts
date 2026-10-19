import { describe, expect, it } from 'vitest';
import { crc32, pngWithDpi } from '../src/png';

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** A PNG chunk with a correct CRC. */
function chunk(type: string, data: number[]): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(ascii(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
const IDAT = chunk('IDAT', [0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0, 0, 0, 4, 0, 1]);
const IEND = chunk('IEND', []);

/** Chunks of a PNG, with their CRCs checked. */
function chunks(png: Uint8Array) {
  const out: { type: string; data: Uint8Array }[] = [];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let at = 8; at < png.length;) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    expect(view.getUint32(at + 8 + size), `${type} CRC`).toBe(crc32(png.subarray(at + 4, at + 8 + size)));
    out.push({ type, data: png.subarray(at + 8, at + 8 + size) });
    at += 12 + size;
  }
  return out;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('pngWithDpi', () => {
  const png = concat(SIGNATURE, IHDR, IDAT, IEND);

  it('declares 300 DPI right after the header, leaving every other chunk as it was', () => {
    const out = pngWithDpi(png, 300);
    expect(out.length).toBe(png.length + 21);
    expect(chunks(out).map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    const phys = new DataView(chunks(out)[1]!.data.buffer, chunks(out)[1]!.data.byteOffset, 9);
    // 300 dots per inch is 11811 per metre.
    expect([phys.getUint32(0), phys.getUint32(4), phys.getUint8(8)]).toEqual([11811, 11811, 1]);
    expect(out.subarray(0, 8 + IHDR.length)).toEqual(concat(SIGNATURE, IHDR));
    expect(out.subarray(out.length - IDAT.length - IEND.length)).toEqual(concat(IDAT, IEND));
  });

  it('replaces a density that is already there', () => {
    const again = pngWithDpi(pngWithDpi(png, 72), 300);
    expect(chunks(again).filter((c) => c.type === 'pHYs')).toHaveLength(1);
    expect(again).toEqual(pngWithDpi(png, 300));
  });

  it('refuses what is not a PNG', () => {
    expect(() => pngWithDpi(ascii('GIF89a, not a PNG at all, really not one at all'), 300)).toThrow(/PNG/);
    expect(() => pngWithDpi(concat(SIGNATURE, IDAT, IEND), 300)).toThrow(/PNG/); // no header first
    expect(() => pngWithDpi(png.subarray(0, 40), 300)).toThrow(/PNG/); // cut short
    expect(() => pngWithDpi(png, 0)).toThrow(/density/);
  });
});
