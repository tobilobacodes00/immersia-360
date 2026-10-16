/**
 * Template JSON — the single schema for photo-strip layouts and 360 video overlays (PRD "Template":
 * "Layouts and overlays share one schema"). The editor (react-konva) only edits this document; the
 * deterministic renderer in @immersia/layout turns it into pixels for preview, print and video.
 *
 * Geometry is in canvas pixels. Print canvases are authored at 300 DPI (a 4×6 is 1200×1800), so
 * millimetres convert exactly: px = mm / 25.4 × 300.
 */
import { z } from 'zod';
import { PRINT_SIZES } from './event';

export const TEMPLATE_SCHEMA_VERSION = 1;
export const PRINT_DPI = 300;

/** Print sizes in inches, width × height (PHO-3). `story` is 9:16 at 1080×1920. */
export const PRINT_SIZE_INCHES: Record<(typeof PRINT_SIZES)[number], readonly [number, number] | null> = {
  '2x6': [2, 6],
  '4x4': [4, 4],
  '4x6': [4, 6],
  '6x4': [6, 4],
  '5x7': [5, 7],
  story: null,
};

export function canvasSizeFor(size: (typeof PRINT_SIZES)[number]): { width: number; height: number } {
  const inches = PRINT_SIZE_INCHES[size];
  if (!inches) return { width: 1080, height: 1920 };
  return { width: Math.round(inches[0] * PRINT_DPI), height: Math.round(inches[1] * PRINT_DPI) };
}

export const mmToPx = (mm: number, dpi = PRINT_DPI) => (mm / 25.4) * dpi;

const hexA = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

const base = {
  id: z.string().min(1),
  name: z.string().max(80).optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
};

const fit = z.enum(['cover', 'contain']);

/** A guest photo goes here (PHO-1: shot index 0–3). */
export const photoSlotElement = z.object({
  ...base,
  type: z.literal('photo'),
  shot: z.number().int().min(0).max(3),
  fit: fit.default('cover'),
  cornerRadius: z.number().min(0).default(0),
  filterId: z.string().nullable().default(null),
});

export const imageElement = z.object({
  ...base,
  type: z.literal('image'),
  assetId: z.string().min(1),
  fit: fit.default('contain'),
});

export const textElement = z.object({
  ...base,
  type: z.literal('text'),
  /** Token string, e.g. "{eventName} · %d %B %Y" (PHO-3 dynamic fields). */
  text: z.string().max(500),
  fontFamily: z.string().min(1),
  fontWeight: z.number().int().min(100).max(900).default(400),
  fontStyle: z.enum(['normal', 'italic']).default('normal'),
  fontSize: z.number().positive(),
  lineHeight: z.number().positive().default(1.2),
  letterSpacing: z.number().default(0),
  color: hexA,
  align: z.enum(['left', 'center', 'right']).default('center'),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).default('middle'),
  uppercase: z.boolean().default(false),
  /** Shrink to fit the box instead of overflowing (long event names). */
  autoFit: z.boolean().default(true),
});

export const shapeElement = z.object({
  ...base,
  type: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse']),
  fill: hexA,
  stroke: hexA.nullable().default(null),
  strokeWidth: z.number().min(0).default(0),
  cornerRadius: z.number().min(0).default(0),
});

/** Session QR + short code (DL-3: at least 18 mm wide when printed). */
export const qrElement = z.object({
  ...base,
  type: z.literal('qr'),
  dark: hexA.default('#111110'),
  light: hexA.default('#ffffff'),
  showCode: z.boolean().default(true),
});

export const templateElementSchema = z.discriminatedUnion('type', [
  photoSlotElement,
  imageElement,
  textElement,
  shapeElement,
  qrElement,
]);

export const templateCanvasSchema = z.object({
  width: z.number().int().positive().max(8000),
  height: z.number().int().positive().max(8000),
  dpi: z.number().int().positive().default(PRINT_DPI),
  printSize: z.enum(PRINT_SIZES).nullable(),
  background: hexA.default('#ffffff'),
  backgroundAssetId: z.string().nullable().default(null),
});

export type TemplateElement = z.infer<typeof templateElementSchema>;
export type TemplateCanvas = z.infer<typeof templateCanvasSchema>;
