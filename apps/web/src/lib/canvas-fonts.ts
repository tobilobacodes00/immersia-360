/**
 * Canvas text needs the real (hashed) font family names next/font gave our fonts. They are exposed
 * as CSS variables on <html> (see app/layout.tsx); map template font names to them and make sure the
 * faces are loaded before anything is rendered, or a print would fall back to a system font.
 */
export async function canvasFonts(): Promise<Record<string, string>> {
  const css = getComputedStyle(document.documentElement);
  const satoshi = css.getPropertyValue('--font-satoshi').trim() || 'system-ui, sans-serif';
  const serif = css.getPropertyValue('--font-instrument-serif').trim() || 'Georgia, serif';
  await Promise.all(
    [`400 32px ${satoshi}`, `500 32px ${satoshi}`, `700 32px ${satoshi}`, `400 32px ${serif}`].map((f) =>
      document.fonts.load(f).catch(() => undefined),
    ),
  );
  return { Satoshi: satoshi, 'Instrument Serif': serif };
}
