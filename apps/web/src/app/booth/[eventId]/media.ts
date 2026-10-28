'use client';

import { fitDocument, renderTemplate, type RenderInputs, type Template } from '@immersia/layout';
import type { Card } from '@immersia/render-engine';
import { templateAssetIds, templateFontFaces, type TokenContext } from '@immersia/shared';
import { prepareTemplateFonts } from '@/lib/template-fonts';
import type { AssetView } from '@/server/assets';
import { cachedAsset } from './event-assets';

/**
 * A template's images and fonts, ready for the renderer, from the booth's offline asset cache.
 * Images are decoded once; a missing file leaves its element empty rather than failing a guest's
 * strip or video.
 */
export async function templateResources(doc: Template): Promise<Pick<RenderInputs, 'assets' | 'fonts'>> {
  const images = new Map<string, ImageBitmap>();
  const ids = templateAssetIds(doc);
  const [fonts] = await Promise.all([
    prepareTemplateFonts(templateFontFaces(doc), async (id) => (await cachedAsset(id))?.arrayBuffer() ?? null),
    ...ids.map(async (id) => {
      const blob = await cachedAsset(id);
      // Uploaded fonts are referenced too; only images decode.
      if (!blob || !blob.type.startsWith('image/')) return;
      const bmp = await createImageBitmap(blob).catch(() => null);
      if (bmp) images.set(id, bmp);
    }),
  ]);
  return { assets: (id) => images.get(id) ?? null, fonts };
}

/** The design fitted to the canvas the event needs now (its print size or video aspect may have changed). */
export const fitted = (doc: Template, width: number, height: number): Template =>
  doc.canvas.width === width && doc.canvas.height === height ? doc : fitDocument(doc, width, height);

/**
 * The 360 overlay (VID-4) drawn once at the output resolution. Each render job gets its own copy
 * (`createImageBitmap(canvas)`): the render worker takes ownership of the bitmaps it is sent.
 */
export async function renderOverlay(
  doc: Template,
  /** The overlay canvas for the event's aspect (overlayCanvasFor), same aspect as `size`. */
  target: { width: number; height: number },
  size: { width: number; height: number },
  tokens: TokenContext,
): Promise<OffscreenCanvas> {
  const resources = await templateResources(doc);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const design = fitted(doc, target.width, target.height);
  renderTemplate(
    ctx,
    design,
    { photos: [], tokens, qr: null, placeholders: false, ...resources },
    size.width / design.canvas.width,
  );
  return canvas;
}

/** An intro or outro (VID-5): a still card, or a clip capped at the card length. */
export async function loadCard(asset: AssetView | null, cardSeconds: number): Promise<Card | null> {
  if (!asset) return null;
  const blob = await cachedAsset(asset.id);
  if (!blob) return null;
  if (asset.mime.startsWith('image/')) {
    const image = await createImageBitmap(blob).catch(() => null);
    return image ? { kind: 'still', image, seconds: cardSeconds } : null;
  }
  const clipS = asset.durationMs ? asset.durationMs / 1000 : cardSeconds;
  // The plan (and the music mixed to it) uses the real length of a clip shorter than the card.
  return { kind: 'clip', file: blob, maxSeconds: Math.min(cardSeconds, clipS) };
}
