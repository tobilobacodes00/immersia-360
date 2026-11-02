import {
  SIGNAGE_SHEET_MM,
  jpegToPdf,
  pngWithDpi,
  renderToBlob,
  type RenderInputs,
  type SignageFormat,
  type Template,
} from '@immersia/layout';

/** "Sarah & Tom’s Wedding" → "sarah-and-toms-wedding". Letters of any script are kept. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // é → e (Latin accents only; other scripts keep their marks)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** `<event-name>-<format>.png|pdf` */
export const signageFilename = (eventName: string, format: SignageFormat, ext: 'png' | 'pdf') =>
  `${slugify(eventName) || 'event'}-${format}.${ext}`;

/** The sheet at its own 300 DPI, as a PNG that opens at paper size (the density is written in). */
export async function signagePng(t: Template, inputs: RenderInputs): Promise<Blob> {
  const png = await renderToBlob(t, inputs, { type: 'image/png' });
  return new Blob([pngWithDpi(new Uint8Array(await png.arrayBuffer()), t.canvas.dpi)], { type: 'image/png' });
}

/** The sheet as a one-page PDF at paper size: a 300 DPI JPEG scaled to the whole page. */
export async function signagePdf(t: Template, inputs: RenderInputs, format: SignageFormat): Promise<Blob> {
  const jpeg = await renderToBlob(t, inputs, { type: 'image/jpeg', quality: 0.92 });
  const mm = SIGNAGE_SHEET_MM[format];
  const pdf = jpegToPdf(new Uint8Array(await jpeg.arrayBuffer()), t.canvas.width, t.canvas.height, mm.width, mm.height);
  return new Blob([pdf], { type: 'application/pdf' });
}

/** Hand a file to the browser's download (no server round trip). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked later: some browsers start reading the URL after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
