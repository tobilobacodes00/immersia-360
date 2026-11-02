/**
 * PNG pixel density. A canvas PNG carries no resolution, so print dialogs and editors open a
 * 2480 × 3508 px file as 72 DPI, a metre wide. Writing a `pHYs` chunk makes it open at its real
 * size: A4 at 300 DPI.
 */

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 as PNG chunks use it (IEEE 802.3). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

/** A copy of `png` that declares `dpi` dots per inch (square pixels). Throws on anything but a PNG. */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array<ArrayBuffer> {
  if (!(dpi > 0)) throw new Error('pngWithDpi needs a density');
  if (png.length < 33 || SIGNATURE.some((b, i) => png[i] !== b)) throw new Error('pngWithDpi needs a PNG');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  const pixelsPerMetre = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21); // length, "pHYs", x, y, unit (metre), CRC
  const out = new DataView(chunk.buffer);
  out.setUint32(0, 9);
  chunk.set(ascii('pHYs'), 4);
  out.setUint32(8, pixelsPerMetre);
  out.setUint32(12, pixelsPerMetre);
  chunk[16] = 1;
  out.setUint32(17, crc32(chunk.subarray(4, 17)));

  // Walk the chunks: keep all but an existing pHYs, and put ours right after IHDR (before any IDAT).
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= png.length) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const end = at + 12 + size;
    if (end > png.length) throw new Error('pngWithDpi needs a complete PNG');
    if (at === 8 && type !== 'IHDR') throw new Error('pngWithDpi needs a PNG');
    if (type !== 'pHYs') parts.push(png.subarray(at, end));
    if (at === 8) parts.push(chunk);
    at = end;
  }
  if (at !== png.length) throw new Error('pngWithDpi needs a complete PNG');
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    result.set(p, pos);
    pos += p.length;
  }
  return result;
}
