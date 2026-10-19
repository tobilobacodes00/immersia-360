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

/** DL-4: how long the QR end card stays on screen. */
export const END_CARD_SECONDS = 2;

/**
 * DL-4: the closing card of a guest's video: the event name, the guest's own QR and short code, so a
 * video forwarded to friends still leads back to the download. Drawn by the template renderer in the
 * event's theme, at the output resolution.
 */
export async function renderEndCard(o: {
  target: { width: number; height: number };
  size: { width: number; height: number };
  theme: { background: string; ink: string; font: 'sans' | 'serif' };
  eventName: string;
  hint: string;
  link: string;
  code: string | null;
}): Promise<ImageBitmap> {
  const { width: W, height: H } = o.target;
  const unit = Math.min(W, H);
  const qrSide = Math.round(unit * 0.5);
  const qrH = Math.round(qrSide / 0.84);
  const family = o.theme.font === 'serif' ? 'Instrument Serif' : 'Satoshi';
  const common = { rotation: 0, opacity: 1, locked: false, hidden: false } as const;
  const text = (id: string, y: number, h: number, value: string, size: number, weight: number) =>
    ({
      ...common,
      id,
      type: 'text',
      x: Math.round(unit * 0.08),
      y,
      width: Math.round(W - unit * 0.16),
      height: h,
      text: value,
      fontFamily: family,
      fontWeight: weight,
      fontStyle: 'normal',
      fontSize: Math.round(size),
      lineHeight: 1.15,
      letterSpacing: 0,
      color: o.theme.ink,
      align: 'center',
      verticalAlign: 'middle',
      uppercase: false,
      autoFit: true,
    }) as const;
  const top = Math.round((H - qrH) / 2);
  const doc: Template = {
    canvas: { width: W, height: H, dpi: 72, printSize: null, background: o.theme.background, backgroundAssetId: null },
    elements: [
      text(
        'name',
        Math.max(0, top - Math.round(unit * 0.2)),
        Math.round(unit * 0.16),
        o.eventName,
        unit * 0.075,
        o.theme.font === 'serif' ? 400 : 700,
      ),
      {
        ...common,
        id: 'qr',
        type: 'qr',
        x: Math.round((W - qrSide) / 2),
        y: top,
        width: qrSide,
        height: qrH,
        dark: '#111110',
        light: '#ffffff',
        showCode: true,
      },
      text('hint', top + qrH + Math.round(unit * 0.03), Math.round(unit * 0.08), o.hint, unit * 0.04, 500),
    ],
  };
  const resources = await templateResources(doc);
  const canvas = new OffscreenCanvas(o.size.width, o.size.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  renderTemplate(
    ctx,
    doc,
    { photos: [], tokens: {}, qr: { url: o.link, code: o.code }, placeholders: false, ...resources },
    o.size.width / W,
  );
  return canvas.transferToImageBitmap();
}
