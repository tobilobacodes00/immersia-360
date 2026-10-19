/**
 * A single-page PDF around one JPEG, with no dependencies (DL-5 signage). The picture is embedded
 * as-is (DCTDecode), so a 300 DPI A4 poster is a ~1 MB file and nothing is re-compressed. Pure
 * bytes: it runs on the page, in a worker or in Node.
 */

const PT_PER_MM = 72 / 25.4;

/** Points with at most two decimals and no trailing zeros ("595.28", "612"). */
const pt = (mm: number) => String(Math.round(mm * PT_PER_MM * 100) / 100);

/** Colour components of a JPEG, read from its start-of-frame marker; null when it isn't a JPEG. */
function jpegComponents(jpeg: Uint8Array): number | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= jpeg.length) {
    if (jpeg[i] !== 0xff) return null;
    const marker = jpeg[i + 1]!;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    // Markers without a length: standalone (TEM, RSTn, SOI) — skip them.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    const length = (jpeg[i + 2]! << 8) | jpeg[i + 3]!;
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC): precision, height, width, then components.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return jpeg[i + 9] ?? null;
    i += 2 + length;
  }
  return null;
}

/**
 * A valid single-page PDF 1.4 with `jpeg` scaled to fill the whole page. `widthPx`/`heightPx` are
 * the picture's pixels; the page is `pageWidthMm` × `pageHeightMm` (MediaBox in points).
 * Grayscale and RGB JPEGs are supported (what canvas encoders produce).
 */
export function jpegToPdf(
  jpeg: Uint8Array,
  widthPx: number,
  heightPx: number,
  pageWidthMm: number,
  pageHeightMm: number,
): Uint8Array<ArrayBuffer> {
  const components = jpegComponents(jpeg);
  if (components !== 1 && components !== 3) throw new Error('jpegToPdf needs a grayscale or RGB JPEG');
  if (![widthPx, heightPx].every((n) => Number.isInteger(n) && n > 0)) throw new Error('jpegToPdf needs a pixel size');
  if (!(pageWidthMm > 0 && pageHeightMm > 0)) throw new Error('jpegToPdf needs a page size');

  const w = pt(pageWidthMm);
  const h = pt(pageHeightMm);
  const text = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (c: Uint8Array | string) => {
    const bytes = typeof c === 'string' ? text.encode(c) : c;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string, stream?: Uint8Array) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };

  // The comment of high bytes tells transfer tools that the file is binary.
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  object(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /${
      components === 1 ? 'DeviceGray' : 'DeviceRGB'
    } /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    jpeg,
  );
  const content = text.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
  object(5, `<< /Length ${content.length} >>`, content);

  // Every entry is exactly 20 bytes (10-digit offset, 5-digit generation, flag, space, newline).
  const xref = length;
  const entries = [0, 1, 2, 3, 4, 5].map((n) =>
    n === 0 ? '0000000000 65535 f \n' : `${String(offsets[n]).padStart(10, '0')} 00000 n \n`,
  );
  push(`xref\n0 6\n${entries.join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
