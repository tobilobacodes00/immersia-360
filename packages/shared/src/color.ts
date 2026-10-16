/** WCAG 2.x colour maths, used for guest theming and the design-token contrast tests. */

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function parseHex(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const INK = '#111110';
export const WHITE = '#ffffff';

/**
 * Readable text on an event's accent colour. Picks whichever of ink or white contrasts more.
 * (Immersia Booth switched at a fixed luminance of 0.42, which put white text on mid-tone accents
 * below 4.5:1; choosing by measured contrast is never worse.)
 */
export function onAccent(accent: string): string {
  if (!parseHex(accent)) return WHITE;
  return contrastRatio(accent, INK) >= contrastRatio(accent, WHITE) ? INK : WHITE;
}
