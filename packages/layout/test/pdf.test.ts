import { describe, expect, it } from 'vitest';
import { jpegToPdf } from '../src/pdf';

/**
 * The smallest thing the writer reads as a JPEG: SOI, a baseline frame header, some bytes standing
 * in for the scan (including words that would fool a parser that looks for them), EOI.
 */
function fakeJpeg(components = 3, scan = 4096): Uint8Array {
  const frame = [
    0xff,
    0xc0,
    0x00,
    8 + 3 * components,
    8,
    0x00,
    0x20,
    0x00,
    0x10,
    components,
    ...Array.from({ length: components }, (_, i) => [i + 1, 0x11, 0]).flat(),
  ];
  const body = Array.from({ length: scan }, (_, i) => (i * 31 + 7) & 0xff);
  const trap = [...new TextEncoder().encode('\nendstream\nendobj\n')];
  return new Uint8Array([0xff, 0xd8, ...frame, ...body.slice(0, 100), ...trap, ...body.slice(100), 0xff, 0xd9]);
}

const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

describe('jpegToPdf', () => {
  const jpeg = fakeJpeg();
  const pdf = jpegToPdf(jpeg, 2480, 3508, 210, 297);
  const text = latin1(pdf);

  it('is a PDF 1.4 file with a binary marker and an end-of-file marker', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('\n%%EOF\n')).toBe(true);
    // The second line is a comment of bytes above 127, as the spec recommends.
    const second = pdf.subarray(9, 14);
    expect(second[0]).toBe(0x25);
    expect([...second.subarray(1)].every((b) => b > 127)).toBe(true);
  });

  it('has a cross-reference table whose offsets point at their objects', () => {
    const start = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
    expect(text.slice(start, start + 9)).toBe('xref\n0 6\n');
    const entries = text.slice(start + 9, start + 9 + 6 * 20);
    expect(entries).toHaveLength(120);
    const rows = Array.from({ length: 6 }, (_, i) => entries.slice(i * 20, i * 20 + 20));
    expect(rows[0]).toBe('0000000000 65535 f \n');
    const offsets: number[] = [];
    for (let n = 1; n <= 5; n++) {
      expect(rows[n]).toMatch(/^\d{10} 00000 n \n$/);
      const offset = Number(rows[n]!.slice(0, 10));
      offsets.push(offset);
      expect(text.slice(offset, offset + `${n} 0 obj\n`.length)).toBe(`${n} 0 obj\n`);
    }
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(text).toContain('trailer\n<< /Size 6 /Root 1 0 R >>');
  });

  it('sets the page size in points from the millimetres', () => {
    const [, w, h] = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text)!.map(Number);
    expect(w).toBeCloseTo((210 * 72) / 25.4, 2);
    expect(h).toBeCloseTo((297 * 72) / 25.4, 2);
    expect(`${w} ${h}`).toBe('595.28 841.89');
    const a5 = latin1(jpegToPdf(jpeg, 1748, 2480, 148, 210));
    expect(a5).toContain('/MediaBox [0 0 419.53 595.28]');
  });

  it('draws the picture over the whole page', () => {
    expect(text).toContain('q 595.28 0 0 841.89 0 0 cm /Im0 Do Q');
    const content = /5 0 obj\n<< \/Length (\d+) >>\nstream\n/.exec(text)!;
    expect(Number(content[1])).toBe('q 595.28 0 0 841.89 0 0 cm /Im0 Do Q'.length);
  });

  it('embeds the JPEG untouched, with its exact length', () => {
    const image = text.indexOf('4 0 obj\n');
    const dict = text.slice(image, text.indexOf('stream\n', image));
    expect(dict).toContain('/Subtype /Image');
    expect(dict).toContain('/Width 2480 /Height 3508');
    expect(dict).toContain('/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode');
    expect(Number(/\/Length (\d+)/.exec(dict)![1])).toBe(jpeg.length);
    const from = text.indexOf('stream\n', image) + 'stream\n'.length;
    expect(pdf.subarray(from, from + jpeg.length)).toEqual(jpeg);
    expect(text.slice(from + jpeg.length, from + jpeg.length + 17)).toBe('\nendstream\nendobj');
  });

  it('reads grayscale pictures too', () => {
    expect(latin1(jpegToPdf(fakeJpeg(1), 16, 32, 100, 100))).toContain('/ColorSpace /DeviceGray');
  });

  it('refuses what it can not embed', () => {
    expect(() => jpegToPdf(new Uint8Array([1, 2, 3, 4, 5]), 10, 10, 100, 100)).toThrow(/JPEG/);
    expect(() => jpegToPdf(fakeJpeg(4), 10, 10, 100, 100)).toThrow(/JPEG/); // CMYK
    expect(() => jpegToPdf(jpeg, 0, 10, 100, 100)).toThrow(/pixel/);
    expect(() => jpegToPdf(jpeg, 10.5, 10, 100, 100)).toThrow(/pixel/);
    expect(() => jpegToPdf(jpeg, 10, 10, 0, 100)).toThrow(/page/);
  });
});
