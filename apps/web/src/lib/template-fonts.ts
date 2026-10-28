import { assetIdOfFont } from '@immersia/shared';
import { findFamily, fontStack, loadLibraryFamily, registerFontData } from '@immersia/fonts';
import { canvasFonts } from './canvas-fonts';

/** Uploaded fonts are registered under a private family name, so they never clash with a real one. */
export const assetFontFace = (assetId: string) => `imm-font-${assetId}`;

export type FontResolver = (family: string) => string | undefined;
export interface TemplateFace {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
}

/** Uploaded fonts already registered in this page (their bytes are fetched once). */
const registered = new Set<string>();

/**
 * Load every face a template's text needs (`templateFontFaces(doc)`) and return the renderer's font
 * resolver (PHO-9). Fonts are loaded before anything is drawn: a canvas silently falls back to a
 * system font otherwise, and a print or video would not match the editor.
 *
 * - Built-ins (Satoshi, Instrument Serif): next/font's hashed families, via CSS variables.
 * - Library families: self-hosted files from @immersia/fonts.
 * - Uploaded fonts (`asset:<id>`): bytes from `assetBytes` (network in the editor, the offline cache
 *   on a booth). A font that can't be read degrades to the fallback stack instead of failing.
 */
export async function prepareTemplateFonts(
  faces: TemplateFace[],
  assetBytes: (assetId: string) => Promise<ArrayBuffer | null>,
): Promise<FontResolver> {
  const builtIn = await canvasFonts();
  const byFamily = new Map<string, number[]>();
  for (const f of faces) byFamily.set(f.family, [...(byFamily.get(f.family) ?? []), f.weight]);
  await Promise.all(
    [...byFamily].map(async ([family, weights]) => {
      if (builtIn[family]) return;
      const assetId = assetIdOfFont(family);
      if (assetId) {
        if (registered.has(assetId)) return;
        const bytes = await assetBytes(assetId).catch(() => null);
        if (!bytes) return;
        await registerFontData(assetFontFace(assetId), bytes).then(
          () => registered.add(assetId),
          () => undefined,
        );
        return;
      }
      const lib = findFamily(family);
      if (!lib) return;
      // The canvas picks the nearest face for a weight the family lacks; load exactly that face.
      const nearest = (w: number) => lib.weights.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
      await loadLibraryFamily(family, { weights: [...new Set(weights.map(nearest))] }).catch(() => undefined);
    }),
  );
  return (family) => {
    if (builtIn[family]) return builtIn[family];
    const assetId = assetIdOfFont(family);
    if (assetId) return registered.has(assetId) ? `"${assetFontFace(assetId)}", sans-serif` : 'sans-serif';
    return fontStack(family);
  };
}
