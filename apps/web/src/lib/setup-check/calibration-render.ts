import { PRINT_DPI, PRINT_SIZE_INCHES, canvasSizeFor, type PRINT_SIZES } from '@immersia/shared';
import { calibrationSheet, type Primitive } from './calibration';

/** Capital height as a share of the font size, for the system sans-serif the sheet is drawn in. */
const CAP_HEIGHT = 0.72;

function draw(ctx: CanvasRenderingContext2D, primitives: Primitive[]) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';
  ctx.lineCap = 'butt';
  for (const p of primitives) {
    switch (p.kind) {
      case 'line':
        ctx.lineWidth = p.width;
        ctx.beginPath();
        ctx.moveTo(p.x1, p.y1);
        ctx.lineTo(p.x2, p.y2);
        ctx.stroke();
        break;
      case 'rect':
        ctx.lineWidth = p.width;
        ctx.strokeRect(p.x, p.y, p.w, p.h);
        break;
      case 'circle':
        ctx.lineWidth = p.width;
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'text':
        ctx.font = `${p.bold ? 700 : 500} ${Math.round(p.size / CAP_HEIGHT)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
        ctx.textAlign = p.align;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(p.text, p.x, p.y);
        break;
    }
  }
}

/**
 * The calibration sheet as a PNG at the event's print size and 300 DPI, ready for `browserPrint`.
 * Throws for sizes with no paper dimensions (the 9:16 story is for screens).
 */
export async function renderCalibrationSheet(size: (typeof PRINT_SIZES)[number]): Promise<Blob> {
  const inches = PRINT_SIZE_INCHES[size];
  if (!inches) throw new Error(`${size} has no paper size`);
  const { width, height } = canvasSizeFor(size);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  draw(ctx, calibrationSheet(width, height, PRINT_DPI, `${inches[0]}×${inches[1]} in`).primitives);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the sheet'))), 'image/png'),
  );
}
