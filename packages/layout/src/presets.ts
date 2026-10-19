import { canvasSizeFor, mmToPx, type PRINT_SIZES, type TemplateElement } from '@immersia/shared';
import type { Template } from './render';

export type PrintSize = (typeof PRINT_SIZES)[number];
export type Shots = 1 | 2 | 3 | 4;

export interface PresetOptions {
  shots: Shots;
  background: string;
  ink: string;
  font: 'sans' | 'serif';
  /** Corner QR + short code (DL-3), on by default. */
  qr?: boolean;
}

/** DL-3: a printed QR is at least 18 mm wide so phones read it from arm's length. */
export const MIN_PRINT_QR_PX = Math.ceil(mmToPx(18));
/** Share of a QR element's height given to the short code under it (see render.ts). */
const CODE_BAND = 0.16;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Footer (title panel) share of the canvas height, per size. */
const FOOTER: Record<PrintSize, number> = {
  '2x6': 0.21,
  '4x4': 0.25,
  '4x6': 0.17,
  '6x4': 0.25,
  '5x7': 0.15,
  story: 0.15,
};

/** How the shots tile the photo area. `hero`: the first shot spans the long side. */
type Arrangement = { cols: number; rows: number; hero?: 'top' | 'left' };

function arrangement(size: PrintSize, shots: Shots): Arrangement {
  if (size === '2x6' || size === 'story') return { cols: 1, rows: shots };
  if (shots === 1) return { cols: 1, rows: 1 };
  if (shots === 4) return { cols: 2, rows: 2 };
  if (size === '6x4') return { cols: shots, rows: 1 };
  if (size === '4x4') return shots === 2 ? { cols: 2, rows: 1 } : { cols: 2, rows: 2, hero: 'left' };
  // Portrait 4×6 and 5×7.
  return shots === 2 ? { cols: 1, rows: 2 } : { cols: 2, rows: 2, hero: 'top' };
}

function photoBoxes(area: Box, a: Arrangement, shots: Shots, gap: number): Box[] {
  const cw = (area.w - gap * (a.cols - 1)) / a.cols;
  const ch = (area.h - gap * (a.rows - 1)) / a.rows;
  const cell = (c: number, r: number, cs = 1, rs = 1): Box => ({
    x: area.x + c * (cw + gap),
    y: area.y + r * (ch + gap),
    w: cw * cs + gap * (cs - 1),
    h: ch * rs + gap * (rs - 1),
  });
  if (a.hero === 'top') return [cell(0, 0, 2, 1), cell(0, 1), cell(1, 1)];
  if (a.hero === 'left') return [cell(0, 0, 1, 2), cell(1, 0), cell(1, 1)];
  const boxes: Box[] = [];
  for (let i = 0; i < shots; i++) boxes.push(cell(i % a.cols, Math.floor(i / a.cols)));
  return boxes;
}

const round = (b: Box): Box => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });

/**
 * A ready-made layout for any print size and shot count (PHO-1, PHO-3): photos tiled over a title
 * panel with the event name and date (dynamic fields) and, on prints, the session QR and code.
 * The operator restyles or replaces it in the editor (M6); these keep every event printable
 * from the start.
 */
export function presetTemplate(size: PrintSize, o: PresetOptions): Template {
  const { width: W, height: H } = canvasSizeFor(size);
  const unit = Math.min(W, H);
  const margin = Math.round(unit * 0.06);
  const gap = Math.round(unit * 0.035);
  const footerH = Math.round(H * FOOTER[size]);
  const area: Box = { x: margin, y: margin, w: W - 2 * margin, h: H - 2 * margin - footerH };
  const elements: TemplateElement[] = photoBoxes(area, arrangement(size, o.shots), o.shots, gap).map(
    (b, shot): TemplateElement => ({
      ...round(b),
      id: `photo-${shot}`,
      type: 'photo',
      shot,
      fit: 'cover',
      cornerRadius: Math.round(unit * 0.012),
      filterId: null,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
    }),
  );

  const footer: Box = { x: margin, y: H - margin - footerH + gap, w: W - 2 * margin, h: footerH - gap };
  const wantQr = (o.qr ?? true) && size !== 'story';
  // The QR fills the footer's height (never below 18 mm) on the right; the title takes the rest.
  const qrSide = wantQr
    ? Math.max(MIN_PRINT_QR_PX, Math.round(Math.min(footer.h * (1 - CODE_BAND), footer.w * 0.42)))
    : 0;
  const qrH = Math.round(qrSide / (1 - CODE_BAND));
  const titleW = wantQr ? footer.w - qrSide - gap : footer.w;
  const family = o.font === 'serif' ? 'Instrument Serif' : 'Satoshi';
  const titleSize = Math.round(Math.min(footer.h * 0.38, unit * 0.11));
  const text = (id: string, box: Box, text: string, fontSize: number, extra: Partial<TemplateElement> = {}) =>
    ({
      ...round(box),
      id,
      type: 'text',
      text,
      fontFamily: family,
      fontWeight: o.font === 'serif' ? 400 : 700,
      fontStyle: 'normal',
      fontSize,
      lineHeight: 1.1,
      letterSpacing: o.font === 'serif' ? 0 : -fontSize * 0.03,
      color: o.ink,
      align: wantQr ? 'left' : 'center',
      verticalAlign: 'middle',
      uppercase: false,
      autoFit: true,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      ...extra,
    }) as TemplateElement;
  elements.push(text('title', { x: footer.x, y: footer.y, w: titleW, h: footer.h * 0.62 }, '{eventName}', titleSize));
  elements.push(
    text(
      'date',
      { x: footer.x, y: footer.y + footer.h * 0.62, w: titleW, h: footer.h * 0.3 },
      '%d %B %Y',
      Math.round(titleSize * 0.36),
      {
        fontFamily: 'Satoshi',
        fontWeight: 500,
        letterSpacing: Math.round(titleSize * 0.36 * 0.08),
        uppercase: true,
      } as Partial<TemplateElement>,
    ),
  );
  if (wantQr)
    elements.push({
      id: 'qr',
      type: 'qr',
      x: footer.x + footer.w - qrSide,
      y: Math.round(footer.y + (footer.h - qrH) / 2),
      width: qrSide,
      height: qrH,
      dark: o.ink,
      light: o.background,
      showCode: true,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
    });

  return {
    canvas: {
      width: W,
      height: H,
      dpi: 300,
      printSize: size,
      background: o.background,
      backgroundAssetId: null,
    },
    elements,
  };
}

/** Print rules the editor and the booth enforce (DL-3). Empty when the template is fine. */
export function printIssues(t: Template): ('qr_too_small' | 'qr_off_canvas')[] {
  const issues = new Set<'qr_too_small' | 'qr_off_canvas'>();
  if (!t.canvas.printSize || t.canvas.printSize === 'story') return [];
  for (const el of t.elements) {
    if (el.type !== 'qr' || el.hidden) continue;
    const side = Math.min(el.width, el.height * (el.showCode ? 1 - CODE_BAND : 1));
    if (side < MIN_PRINT_QR_PX - 0.5) issues.add('qr_too_small');
    if (el.x < 0 || el.y < 0 || el.x + el.width > t.canvas.width || el.y + el.height > t.canvas.height)
      issues.add('qr_off_canvas');
  }
  return [...issues];
}
