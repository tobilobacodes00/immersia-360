/**
 * The printer calibration sheet (HLP-1): geometry only, in pixels, so it can be tested exactly and
 * drawn by any canvas. Printed at 100 % through the same code as a guest's print, it lets the
 * operator check three things with a ruler: the scale (a 50 mm ruler and the distance between the
 * corner marks), the shape (a 20 mm circle that must be round) and the crop (frames 1 to 4 mm in
 * from each edge: the printer cropped as many millimetres as frames are missing).
 *
 * The sheet carries numbers and units only, no sentences, so it needs no translation; the screen
 * around it explains what to look for.
 */

export const MM_PER_INCH = 25.4;

export type Primitive =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; width: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; width: number }
  | {
      kind: 'text';
      x: number;
      /** Baseline. */
      y: number;
      text: string;
      /** Height of a capital letter, in pixels. */
      size: number;
      align: 'left' | 'center' | 'right';
      bold?: boolean;
    };

export const RULER_MM = 50;
/** Frames drawn in from each edge, in millimetres. */
export const FRAME_INSETS_MM = [1, 2, 3, 4] as const;
/** The corner marks sit outside the frames, this far from the edge. */
export const MARK_INSET_MM = 6;
const MARK_ARM_MM = 8;
const CIRCLE_DIAMETER_MM = 20;
/** Sheets narrower than this (a 2 inch strip) have no room for a horizontal 50 mm ruler. */
const HORIZONTAL_RULER_MIN_MM = 62;

export const pxPerMm = (dpi: number) => dpi / MM_PER_INCH;

export interface Sheet {
  primitives: Primitive[];
  /** Distance between the outer corner marks, in millimetres (printed on the sheet). */
  marksMm: { w: number; h: number };
  rulers: { orientation: 'h' | 'v'; x: number; y: number; lengthPx: number }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * @param sizeName how the print size is written on the sheet, e.g. "4×6 in"
 */
export function calibrationSheet(widthPx: number, heightPx: number, dpi: number, sizeName: string): Sheet {
  const mm = pxPerMm(dpi);
  const wMm = widthPx / mm;
  const hMm = heightPx / mm;
  const hair = Math.max(1, Math.round(0.12 * mm)); // ~0.12 mm
  const bold = Math.max(2, Math.round(0.3 * mm));
  const out: Primitive[] = [];

  // Crop frames.
  for (const inset of FRAME_INSETS_MM) {
    const d = inset * mm;
    out.push({ kind: 'rect', x: d, y: d, w: widthPx - 2 * d, h: heightPx - 2 * d, width: hair });
  }

  // Corner marks: an L in each corner, arms pointing inwards, outer corner at the mark inset.
  const m = MARK_INSET_MM * mm;
  const arm = MARK_ARM_MM * mm;
  const corners: [number, number, number, number][] = [
    [m, m, 1, 1],
    [widthPx - m, m, -1, 1],
    [m, heightPx - m, 1, -1],
    [widthPx - m, heightPx - m, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    out.push({ kind: 'line', x1: x, y1: y, x2: x + sx * arm, y2: y, width: bold });
    out.push({ kind: 'line', x1: x, y1: y, x2: x, y2: y + sy * arm, width: bold });
  }
  const marksMm = { w: round1(wMm - 2 * MARK_INSET_MM), h: round1(hMm - 2 * MARK_INSET_MM) };

  // Layout in millimetres. A portrait sheet stacks everything down its middle; a landscape or square
  // one puts the circle and the words on the left and the rulers on the right.
  const portrait = hMm > wMm;
  const textCx = (portrait ? wMm / 2 : wMm * 0.3) * mm;
  const circleY = 36 * mm;
  const wide = wMm >= HORIZONTAL_RULER_MIN_MM;
  const rulers: Sheet['rulers'] = [];
  if (portrait) {
    rulers.push({ orientation: 'v', x: (wMm / 2 - 2.5) * mm, y: 62 * mm, lengthPx: RULER_MM * mm });
    if (wide) rulers.push({ orientation: 'h', x: ((wMm - RULER_MM) / 2) * mm, y: 122 * mm, lengthPx: RULER_MM * mm });
  } else {
    rulers.push({ orientation: 'v', x: (wMm * 0.72 - 2.5) * mm, y: 20 * mm, lengthPx: RULER_MM * mm });
    if (wide) rulers.push({ orientation: 'h', x: ((wMm - RULER_MM) / 2) * mm, y: 82 * mm, lengthPx: RULER_MM * mm });
  }
  for (const r of rulers) out.push(...rulerPrimitives(r, mm, hair, bold));

  // A circle that must stay round, with a cross at its centre.
  const r = (CIRCLE_DIAMETER_MM / 2) * mm;
  out.push({ kind: 'circle', cx: textCx, cy: circleY, r, width: hair });
  out.push({ kind: 'line', x1: textCx - r - 2 * mm, y1: circleY, x2: textCx + r + 2 * mm, y2: circleY, width: hair });
  out.push({ kind: 'line', x1: textCx, y1: circleY - r - 2 * mm, x2: textCx, y2: circleY + r + 2 * mm, width: hair });

  // Words: names and numbers only.
  const cap = Math.round(1.5 * mm);
  out.push({
    kind: 'text',
    x: textCx,
    y: 14 * mm,
    text: `Immersia 360 · ${sizeName}`,
    size: Math.round(1.9 * mm),
    align: 'center',
    bold: true,
  });
  out.push({ kind: 'text', x: textCx, y: 20 * mm, text: '1 · 2 · 3 · 4 mm', size: cap, align: 'center' });
  out.push({
    kind: 'text',
    x: textCx,
    y: 56 * mm,
    text: `${marksMm.w} × ${marksMm.h} mm`,
    size: cap,
    align: 'center',
  });

  return { primitives: out, marksMm, rulers };
}

/** A ruler's baseline, end caps, millimetre ticks (longer at 5 and 10) and number labels. */
function rulerPrimitives(ruler: Sheet['rulers'][number], mm: number, hair: number, bold: number): Primitive[] {
  const out: Primitive[] = [];
  const horizontal = ruler.orientation === 'h';
  const at = (along: number, across: number) =>
    horizontal ? { x: ruler.x + along, y: ruler.y + across } : { x: ruler.x + across, y: ruler.y + along };
  const tick = (along: number, length: number, width: number): Primitive => {
    const a = at(along, 0);
    const b = at(along, length);
    return { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, width };
  };
  const start = at(0, 0);
  const end = at(ruler.lengthPx, 0);
  out.push({ kind: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y, width: hair });
  for (let i = 0; i <= RULER_MM; i++) {
    const length = (i % 10 === 0 ? 5 : i % 5 === 0 ? 3.5 : 2) * mm;
    out.push(tick(i * mm, length, i === 0 || i === RULER_MM ? bold : hair));
    if (i % 10 === 0) {
      const label = i === RULER_MM ? `${i} mm` : String(i);
      // Past the longest tick: below a horizontal ruler, to the right of a vertical one.
      const p = horizontal ? at(i * mm, 5 * mm + 3 * mm) : at(i * mm, 5 * mm + 1 * mm);
      out.push({
        kind: 'text',
        x: p.x,
        y: horizontal ? p.y : p.y + 0.75 * mm,
        text: label,
        size: Math.round(1.5 * mm),
        align: horizontal ? 'center' : 'left',
      });
    }
  }
  return out;
}

/** The extent of a primitive's anchor and geometry; used by the tests to keep everything on the sheet. */
export function bounds(p: Primitive): { minX: number; minY: number; maxX: number; maxY: number } {
  switch (p.kind) {
    case 'line':
      return {
        minX: Math.min(p.x1, p.x2),
        minY: Math.min(p.y1, p.y2),
        maxX: Math.max(p.x1, p.x2),
        maxY: Math.max(p.y1, p.y2),
      };
    case 'rect':
      return { minX: p.x, minY: p.y, maxX: p.x + p.w, maxY: p.y + p.h };
    case 'circle':
      return { minX: p.cx - p.r, minY: p.cy - p.r, maxX: p.cx + p.r, maxY: p.cy + p.r };
    case 'text':
      return { minX: p.x, minY: p.y - p.size, maxX: p.x, maxY: p.y };
  }
}
