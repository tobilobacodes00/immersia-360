import { encode } from 'uqr';
import {
  evaluate,
  formatShortCode,
  type TemplateCanvas,
  type TemplateElement,
  type TokenContext,
} from '@immersia/shared';

/**
 * The one renderer for templates (photo strips, collages, video overlays). The booth's print, the
 * guest's JPEG, the editor preview and the server fallback all draw through here, so what the
 * operator designs is what prints (acceptance #3: within 1 mm).
 *
 * Pure canvas 2D: no DOM, no React. It runs on the page or in a worker (OffscreenCanvas).
 */

export interface Template {
  canvas: TemplateCanvas;
  elements: TemplateElement[];
}

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Anything canvas can draw that has a size we can read. */
export type Drawable = ImageBitmap | VideoFrame | OffscreenCanvas | HTMLCanvasElement | HTMLImageElement;

export interface RenderInputs {
  /** Guest photos by shot index (PHO-1). */
  photos: (Drawable | null)[];
  /** Dynamic fields (PHO-3): event name, date, custom text, short code… */
  tokens: TokenContext;
  /** Uploaded assets (logos, frames), by id. */
  assets?: (id: string) => Drawable | null;
  /** The session's link and short code, for QR elements (DL-3). */
  qr?: { url: string; code: string | null } | null;
  /** Editor and previews: numbered slots for missing photos, outlines for missing assets. */
  placeholders?: boolean;
  /**
   * Template font family → CSS font-family stack. Fonts must be loaded before rendering; the hosts
   * (editor, booth) resolve library, built-in and uploaded (`asset:<id>`) families through this.
   */
  fonts?: Record<string, string> | ((family: string) => string | undefined);
}

/** Size of anything drawable. */
export function sizeOf(d: Drawable): [number, number] {
  if (typeof VideoFrame !== 'undefined' && d instanceof VideoFrame) return [d.displayWidth, d.displayHeight];
  if (typeof HTMLImageElement !== 'undefined' && d instanceof HTMLImageElement)
    return [d.naturalWidth, d.naturalHeight];
  const s = d as { width: number; height: number };
  return [s.width, s.height];
}

/** Draw an image into a box, cropping to fill it (cover) or letterboxing inside it (contain). */
export function drawFitted(ctx: Ctx2D, img: Drawable, w: number, h: number, fit: 'cover' | 'contain') {
  const [iw, ih] = sizeOf(img);
  if (!iw || !ih) return;
  if (fit === 'cover') {
    const s = Math.max(w / iw, h / ih);
    const sw = w / s;
    const sh = h / s;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, w, h);
  } else {
    const s = Math.min(w / iw, h / ih);
    ctx.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
  }
}

function roundedRect(ctx: Ctx2D, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, rr);
}

/** Place the context at the element's box, rotated about its centre. */
function inBox(ctx: Ctx2D, el: TemplateElement, draw: () => void) {
  ctx.save();
  ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.width / 2, -el.height / 2);
  ctx.globalAlpha = el.opacity;
  draw();
  ctx.restore();
}

const DEFAULT_FONTS: Record<string, string> = {
  Satoshi: 'Satoshi, system-ui, sans-serif',
  'Instrument Serif': '"Instrument Serif", Georgia, serif',
};

function resolveFamily(name: string, fonts: RenderInputs['fonts']): string {
  const custom = typeof fonts === 'function' ? fonts(name) : fonts?.[name];
  // Unknown names are quoted so families with spaces or digits stay valid CSS.
  return custom ?? DEFAULT_FONTS[name] ?? `"${name.replace(/"/g, '')}", sans-serif`;
}

/** Greedy word wrap; a single word wider than the box is kept on its own line (and shrunk by autoFit). */
export function wrapText(ctx: Ctx2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function drawText(ctx: Ctx2D, el: Extract<TemplateElement, { type: 'text' }>, inp: RenderInputs) {
  let text = evaluate(el.text, inp.tokens);
  if (el.uppercase) text = text.toUpperCase();
  const family = resolveFamily(el.fontFamily, inp.fonts);
  const setFont = (size: number) => {
    ctx.font = `${el.fontStyle === 'italic' ? 'italic ' : ''}${el.fontWeight} ${size}px ${family}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(el.letterSpacing * size) / el.fontSize}px`;
  };
  // Shrink to fit (long event names) in steps of 4%, down to 30% of the design size.
  let size = el.fontSize;
  let lines: string[];
  for (;;) {
    setFont(size);
    lines = wrapText(ctx, text, el.width);
    const fits =
      lines.length * size * el.lineHeight <= el.height + 0.5 &&
      lines.every((l) => ctx.measureText(l).width <= el.width + 0.5);
    if (!el.autoFit || fits || size <= el.fontSize * 0.3) break;
    size *= 0.96;
  }
  ctx.fillStyle = el.color;
  ctx.textAlign = el.align;
  ctx.textBaseline = 'middle';
  const lh = size * el.lineHeight;
  const block = lh * lines.length;
  const top =
    el.verticalAlign === 'top' ? 0 : el.verticalAlign === 'bottom' ? el.height - block : (el.height - block) / 2;
  const x = el.align === 'left' ? 0 : el.align === 'right' ? el.width : el.width / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, top + lh * i + lh / 2));
}

/** A QR module grid, drawn as crisp squares (no image smoothing, no DOM). */
function drawQr(ctx: Ctx2D, el: Extract<TemplateElement, { type: 'qr' }>, inp: RenderInputs) {
  const url = inp.qr?.url;
  const codeBand = el.showCode && inp.qr?.code ? el.height * 0.16 : 0;
  const side = Math.min(el.width, el.height - codeBand);
  const x0 = (el.width - side) / 2;
  ctx.fillStyle = el.light;
  ctx.fillRect(0, 0, el.width, el.height);
  if (!url) {
    if (inp.placeholders) {
      ctx.strokeStyle = el.dark;
      ctx.setLineDash([side / 20, side / 30]);
      ctx.lineWidth = side / 60;
      ctx.strokeRect(x0, 0, side, side);
    }
    return;
  }
  const qr = encode(url, { ecc: 'M', border: 1 });
  const m = side / qr.size;
  ctx.fillStyle = el.dark;
  for (let r = 0; r < qr.size; r++)
    for (let c = 0; c < qr.size; c++) if (qr.data[r]![c]) ctx.fillRect(x0 + c * m, r * m, Math.ceil(m), Math.ceil(m)); // ceil: no hairline seams
  if (codeBand && inp.qr?.code) {
    ctx.font = `700 ${codeBand * 0.7}px ui-monospace, "Cascadia Code", Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatShortCode(inp.qr.code), el.width / 2, side + codeBand / 2);
  }
}

export function drawElement(ctx: Ctx2D, el: TemplateElement, inp: RenderInputs) {
  if (el.hidden) return;
  inBox(ctx, el, () => drawElementContent(ctx, el, inp));
}

/**
 * An element's pixels in its own box ((0,0)–(width,height)), without position, rotation or opacity.
 * The editor's canvas nodes draw through this, so the editor shows exactly what prints.
 */
export function drawElementContent(ctx: Ctx2D, el: TemplateElement, inp: RenderInputs) {
  ctx.save();
  try {
    drawContent(ctx, el, inp);
  } finally {
    ctx.restore();
  }
}

function drawContent(ctx: Ctx2D, el: TemplateElement, inp: RenderInputs) {
  switch (el.type) {
    case 'photo': {
      const img = inp.photos[el.shot] ?? null;
      roundedRect(ctx, el.width, el.height, el.cornerRadius);
      ctx.clip();
      if (img) drawFitted(ctx, img, el.width, el.height, el.fit);
      else if (inp.placeholders) {
        ctx.fillStyle = '#e4e1da';
        ctx.fillRect(0, 0, el.width, el.height);
        ctx.fillStyle = 'rgba(17,17,16,0.45)';
        ctx.font = `600 ${Math.max(18, Math.min(el.width, el.height) * 0.18)}px Satoshi, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(el.shot + 1), el.width / 2, el.height / 2);
      }
      return;
    }
    case 'image': {
      const img = inp.assets?.(el.assetId) ?? null;
      if (img) drawFitted(ctx, img, el.width, el.height, el.fit);
      else if (inp.placeholders) {
        ctx.strokeStyle = 'rgba(17,17,16,0.4)';
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, el.width - 2, el.height - 2);
      }
      return;
    }
    case 'text':
      return drawText(ctx, el, inp);
    case 'shape': {
      if (el.shape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(el.width / 2, el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
      } else roundedRect(ctx, el.width, el.height, el.cornerRadius);
      ctx.fillStyle = el.fill;
      ctx.fill();
      if (el.stroke && el.strokeWidth > 0) {
        ctx.strokeStyle = el.stroke;
        ctx.lineWidth = el.strokeWidth;
        ctx.stroke();
      }
      return;
    }
    case 'qr':
      return drawQr(ctx, el, inp);
  }
}

/**
 * Render a template at `scale` (1 = its own pixels, e.g. 300 DPI for print). Layers follow the
 * element order (the editor's layer order), over the background colour and background image.
 */
export function renderTemplate(ctx: Ctx2D, t: Template, inp: RenderInputs, scale = 1) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = t.canvas.background;
  ctx.fillRect(0, 0, t.canvas.width, t.canvas.height);
  const bg = t.canvas.backgroundAssetId ? (inp.assets?.(t.canvas.backgroundAssetId) ?? null) : null;
  if (bg) {
    ctx.save();
    // A virtual element so the background crops exactly like a photo.
    drawFitted(ctx, bg, t.canvas.width, t.canvas.height, 'cover');
    ctx.restore();
  }
  for (const el of t.elements) drawElement(ctx, el, inp);
  ctx.restore();
}

/** Render to a new OffscreenCanvas and encode (the guest's JPEG/PNG, the print file). */
export async function renderToBlob(
  t: Template,
  inp: RenderInputs,
  opts: { scale?: number; type?: 'image/jpeg' | 'image/png'; quality?: number } = {},
): Promise<Blob> {
  const scale = opts.scale ?? 1;
  const canvas = new OffscreenCanvas(Math.round(t.canvas.width * scale), Math.round(t.canvas.height * scale));
  renderTemplate(canvas.getContext('2d')!, t, inp, scale);
  return canvas.convertToBlob({ type: opts.type ?? 'image/jpeg', quality: opts.quality ?? 0.92 });
}

/** How many shots a template asks for (its highest photo slot + 1). */
export const shotsIn = (t: Template) =>
  t.elements.reduce((n, el) => (el.type === 'photo' ? Math.max(n, el.shot + 1) : n), 0);
