'use client';

import { renderTemplate, type Template } from '@immersia/layout';
import { overlayCanvasFor, type EventTheme } from '@immersia/shared';
import { renderEndCard, templateResources } from '@/app/booth/[eventId]/media';

type Aspect = Parameters<typeof overlayCanvasFor>[0];

/**
 * The highlight reel's two cards (LIV-14), drawn by the same template renderer, fonts and theme as the booth's own
 * overlays and QR end card: so the reel opens and closes in the event's colours and typeface, at the reel's size.
 */

/** How long each card stays on screen (seconds). The opening is brisk; the closing gives people time to scan. */
export const REEL_INTRO_S = 2.5;
export const REEL_END_S = 3.5;

/** The opening card: the event's name, what the reel is, and the date. */
export async function renderReelIntro(o: {
  aspect: Aspect;
  size: { width: number; height: number };
  theme: EventTheme;
  eventName: string;
  subtitle: string;
  dateLabel: string;
}): Promise<ImageBitmap> {
  const { width: W, height: H } = overlayCanvasFor(o.aspect);
  const unit = Math.min(W, H);
  const family = o.theme.font === 'serif' ? 'Instrument Serif' : 'Satoshi';
  const common = { rotation: 0, locked: false, hidden: false } as const;
  const text = (
    id: string,
    y: number,
    h: number,
    value: string,
    size: number,
    weight: number,
    opacity: number,
    color = o.theme.ink,
  ) =>
    ({
      ...common,
      opacity,
      id,
      type: 'text',
      x: Math.round(unit * 0.08),
      y: Math.round(y),
      width: Math.round(W - unit * 0.16),
      height: Math.round(h),
      text: value,
      fontFamily: family,
      fontWeight: weight,
      fontStyle: 'normal',
      fontSize: Math.round(size),
      lineHeight: 1.1,
      letterSpacing: 0,
      color,
      align: 'center',
      verticalAlign: 'middle',
      uppercase: false,
      autoFit: true,
    }) as const;
  const nameH = unit * 0.3;
  const top = H / 2 - nameH / 2 - unit * 0.07;
  const doc: Template = {
    canvas: { width: W, height: H, dpi: 72, printSize: null, background: o.theme.background, backgroundAssetId: null },
    elements: [
      text('name', top, nameH, o.eventName, unit * 0.11, o.theme.font === 'serif' ? 400 : 700, 1),
      text('subtitle', top + nameH + unit * 0.02, unit * 0.1, o.subtitle, unit * 0.055, 500, 1, o.theme.accent),
      text('date', top + nameH + unit * 0.14, unit * 0.06, o.dateLabel, unit * 0.035, 500, 0.7),
    ],
  };
  const resources = await templateResources(doc);
  const canvas = new OffscreenCanvas(o.size.width, o.size.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  renderTemplate(ctx, doc, { photos: [], tokens: {}, qr: null, placeholders: false, ...resources }, o.size.width / W);
  return canvas.transferToImageBitmap();
}

/** The closing card: the event gallery's QR, so a reel passed around still leads to every photo and video. */
export function renderReelEnd(o: {
  aspect: Aspect;
  size: { width: number; height: number };
  theme: EventTheme;
  eventName: string;
  hint: string;
  link: string;
}): Promise<ImageBitmap> {
  return renderEndCard({
    target: overlayCanvasFor(o.aspect),
    size: o.size,
    theme: o.theme,
    eventName: o.eventName,
    hint: o.hint,
    link: o.link,
    code: null,
  });
}
