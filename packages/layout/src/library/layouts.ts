import { overlayCanvasFor } from '@immersia/shared';
import type { Aspect } from '../overlays';
import type { PrintSize } from '../presets';
import { frameOf, type LibraryLayout } from './geometry';
import { OVERLAY_LAYOUT_DEFS, overlayFrameOf } from './overlay-layouts';
import { PRINT_LAYOUT_DEFS } from './print-layouts';

export type {
  Box,
  Deco,
  Family,
  Geometry,
  LibraryLayout,
  OrnamentRole,
  OrnamentZone,
  PhotoSlot,
  TextZone,
} from './geometry';

/**
 * Every layout geometry of the library (PHO-5): 59 print arrangements over the six print sizes and
 * 15 video overlay designs over the three aspects. Built once, from pure functions of the page size.
 */
export const LIBRARY_LAYOUTS: readonly LibraryLayout[] = [
  ...PRINT_LAYOUT_DEFS.map((d): LibraryLayout => {
    const P = frameOf(d.size);
    return {
      id: d.id,
      kind: 'layout',
      size: d.size,
      family: d.family,
      shots: d.shots,
      canvas: { width: P.W, height: P.H },
      geometry: d.build(P),
    };
  }),
  ...OVERLAY_LAYOUT_DEFS.map((d): LibraryLayout => {
    const O = overlayFrameOf(d.aspect);
    return {
      id: d.id,
      kind: 'overlay',
      size: d.aspect,
      family: d.family,
      shots: 0,
      canvas: overlayCanvasFor(d.aspect),
      geometry: d.build(O),
    };
  }),
];

const byId = new Map(LIBRARY_LAYOUTS.map((l) => [l.id, l]));

export const libraryLayout = (id: string): LibraryLayout | undefined => byId.get(id);

/** The layouts for one print size or video aspect, in a stable order. */
export const layoutsForSize = (size: PrintSize | Aspect): LibraryLayout[] =>
  LIBRARY_LAYOUTS.filter((l) => l.size === size);
