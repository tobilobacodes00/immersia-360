import { INK, WHITE, contrastRatio, mmToPx, onAccent, type TemplateElement } from '@immersia/shared';
import type { Template } from './render';

/**
 * Event QR signage (DL-5): one code for the whole event gallery, printed on an A4 poster, an A5
 * flyer or a table tent, in the event's theme. They are ordinary templates, so the preview, the PNG
 * and the PDF all come out of the one renderer, at 300 DPI.
 *
 * The QR itself is not part of the template (like the session QR on prints): the host passes the
 * gallery URL in `RenderInputs.qr`.
 */

export const SIGNAGE_FORMATS = ['a4', 'a5', 'tent'] as const;
export type SignageFormat = (typeof SIGNAGE_FORMATS)[number];

/**
 * The sheet that goes through the printer, in mm. The table tent is an A4 sheet in portrait: folded
 * across the middle it makes two A5 landscape panels that lean against each other.
 */
export const SIGNAGE_SHEET_MM = {
  a4: { width: 210, height: 297 },
  a5: { width: 148, height: 210 },
  tent: { width: 210, height: 297 },
} as const satisfies Record<SignageFormat, { width: number; height: number }>;

/** Smallest printed QR side per format (a tent panel is A5-sized), so phones scan from a few metres. */
export const SIGNAGE_MIN_QR_MM: Record<SignageFormat, number> = { a4: 60, a5: 40, tent: 40 };

/** Nothing is printed closer than this to a sheet edge (or to the tent's fold): desktop printers can't. */
export const SIGNAGE_SAFE_MM = 12;

const px = (mm: number) => Math.round(mmToPx(mm));

/** The sheet in pixels at 300 DPI. */
export const signageSizePx = (format: SignageFormat) => ({
  width: px(SIGNAGE_SHEET_MM[format].width),
  height: px(SIGNAGE_SHEET_MM[format].height),
});

export interface SignageOptions {
  theme: { accent: string; background: string; ink: string; font: 'sans' | 'serif' };
  eventName: string;
  /** Printed when not empty. */
  hashtag?: string;
  /** "Get your photos & videos" */
  headline: string;
  /** "Scan with your phone camera" */
  cta: string;
  logoAssetId?: string | null;
  /** The logo's width ÷ height, when known: lets the layout place it flush with the text. */
  logoAspect?: number | null;
}

/**
 * Text as the token language reads it back unchanged: `{ } \` and `%` are escaped, and `@` (which
 * can pair up into a `@name@` token) goes through a token that outputs it.
 */
export const literalText = (s: string) =>
  s
    .replace(/[\\{}]/g, (c) => `\\${c}`)
    .replace(/%/g, '%%')
    .replace(/@/g, '{default,,@}');

/** Per-format sizes, in mm. */
interface Spec {
  /** From the sheet edge (and the fold) to the nearest thing printed. */
  margin: number;
  logoH: number;
  logoMaxW: number;
  nameFont: number;
  headFont: number;
  qr: number;
  /** White margin around the QR, so it has a quiet zone on any background. */
  pad: number;
  ctaFont: number;
  ctaH: number;
  ctaW: number;
  tagFont: number;
  /** Space after the logo, name, headline, QR card and CTA. */
  gap: { logo: number; name: number; headline: number; card: number; cta: number };
}

const SPEC: Record<SignageFormat, Spec> = {
  a4: {
    margin: 16,
    logoH: 22,
    logoMaxW: 100,
    nameFont: 15,
    headFont: 8.5,
    qr: 92,
    pad: 10,
    ctaFont: 6.4,
    ctaH: 15,
    ctaW: 132,
    tagFont: 7.5,
    gap: { logo: 8, name: 3, headline: 10, card: 8, cta: 7 },
  },
  a5: {
    margin: 14,
    logoH: 15,
    logoMaxW: 70,
    nameFont: 10.5,
    headFont: 5.8,
    qr: 64,
    pad: 7,
    ctaFont: 4.4,
    ctaH: 10.5,
    ctaW: 92,
    tagFont: 5.2,
    gap: { logo: 5.5, name: 2, headline: 7, card: 5.5, cta: 5 },
  },
  // One A5 landscape panel: text on the left, the QR on the right.
  tent: {
    margin: 14,
    logoH: 13,
    logoMaxW: 60,
    nameFont: 10.5,
    headFont: 5.4,
    qr: 64,
    pad: 7,
    ctaFont: 4.4,
    ctaH: 10,
    ctaW: 84,
    tagFont: 5,
    gap: { logo: 4, name: 2, headline: 5, card: 0, cta: 4 },
  },
};

const solid = (c: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback);

interface Palette {
  ink: string;
  background: string;
  accent: string;
  /** Text on the accent-coloured button. */
  onAccent: string;
  /** Hashtag: the accent where it reads on the page, otherwise the ink. */
  tag: string;
  /** Modules of the QR: always dark on the white card, whatever the theme's ink is. */
  qrDark: string;
  fold: string;
}

function palette(theme: SignageOptions['theme']): Palette {
  const ink = solid(theme.ink, INK);
  const background = solid(theme.background, WHITE);
  const accent = solid(theme.accent, INK);
  return {
    ink,
    background,
    accent,
    onAccent: onAccent(accent),
    tag: contrastRatio(accent, background) >= 4.5 ? accent : ink,
    qrDark: contrastRatio(ink, WHITE) >= 7 ? ink : INK,
    fold: `${ink}66`,
  };
}

/** Whole-pixel box from a position and size in mm. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** A region of the sheet in mm. */
interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}
const box = (x: number, y: number, w: number, h: number): Box => ({
  x: px(x),
  y: px(y),
  width: px(w),
  height: px(h),
});

const common = { rotation: 0, opacity: 1, locked: false, hidden: false } as const;

/** A block of the layout: its height and the space after it, and the elements it draws at `y`. */
interface Row {
  height: number;
  gap: number;
  make: (y: number) => TemplateElement[];
}

/** Rows one under the other, as a block centred between `top` and `bottom`. */
function stack(rows: Row[], top: number, bottom: number): TemplateElement[] {
  const total = rows.reduce((n, r, i) => n + r.height + (i < rows.length - 1 ? r.gap : 0), 0);
  let y = top + Math.max(0, (bottom - top - total) / 2);
  const out: TemplateElement[] = [];
  for (const r of rows) {
    out.push(...r.make(y));
    y += r.height + r.gap;
  }
  return out;
}

/** Lines of text a box is sized for (long names shrink instead, see `autoFit`). */
const textH = (n: number, font: number, lineHeight: number) => Math.ceil(n * font * lineHeight);

/** Everything on one face of the signage: a whole poster, or one panel of the tent. */
function face(layout: 'portrait' | 'landscape', s: Spec, area: Area, o: SignageOptions, p: Palette, ns: string) {
  const serif = o.theme.font === 'serif';
  const display = {
    family: serif ? 'Instrument Serif' : 'Satoshi',
    weight: serif ? 400 : 700,
    tracking: serif ? 0 : -0.03,
  };
  const body = { family: 'Satoshi', weight: 500, tracking: 0 };
  const top = area.y + s.margin;
  const bottom = area.y + area.h - s.margin;
  const cardSide = s.qr + 2 * s.pad;

  // The text column: the whole width on a poster, left of the QR on a tent panel.
  const col =
    layout === 'portrait'
      ? { x: area.x + s.margin, w: area.w - 2 * s.margin, align: 'center' as const }
      : (() => {
          const x = area.x + s.margin;
          return { x, w: area.x + area.w - s.margin - cardSide - 8 - x, align: 'left' as const };
        })();
  /** x of something `w` wide, placed the way the column aligns. */
  const within = (w: number) => (col.align === 'center' ? col.x + (col.w - w) / 2 : col.x);

  const text = (
    name: string,
    b: Box,
    value: string,
    fontMm: number,
    f: { family: string; weight: number; tracking: number },
    extra: Partial<Extract<TemplateElement, { type: 'text' }>> = {},
  ): TemplateElement => {
    const fontSize = px(fontMm);
    return {
      ...common,
      ...b,
      id: `${ns}${name}`,
      type: 'text',
      text: literalText(value),
      fontFamily: f.family,
      fontWeight: f.weight,
      fontStyle: 'normal',
      fontSize,
      lineHeight: 1.1,
      letterSpacing: Math.round(f.tracking * fontSize * 100) / 100,
      color: p.ink,
      align: col.align,
      verticalAlign: 'middle',
      uppercase: false,
      autoFit: true,
      ...extra,
    };
  };

  const rows: Row[] = [];
  if (o.logoAssetId) {
    const assetId = o.logoAssetId;
    // Sized to the picture when we know its shape, so it sits flush with the text, not floating in a box.
    const w =
      o.logoAspect && o.logoAspect > 0
        ? Math.min(s.logoMaxW, col.w, s.logoH * o.logoAspect)
        : Math.min(s.logoMaxW, col.w);
    const h = o.logoAspect && o.logoAspect > 0 ? Math.min(s.logoH, w / o.logoAspect) : s.logoH;
    rows.push({
      height: s.logoH,
      gap: s.gap.logo,
      make: (y) => [
        {
          ...common,
          ...box(within(w), y + (s.logoH - h) / 2, w, h),
          id: `${ns}logo`,
          type: 'image',
          assetId,
          fit: 'contain',
        },
      ],
    });
  }
  const headline = o.headline.trim();
  const cta = o.cta.trim();
  const nameH = textH(2, s.nameFont, 1.08);
  rows.push({
    height: nameH,
    // Without a headline the name is followed by the QR (or the button) at the headline's distance.
    gap: headline ? s.gap.name : s.gap.headline,
    make: (y) => [
      text('name', box(col.x, y, col.w, nameH), o.eventName, s.nameFont, display, {
        lineHeight: 1.08,
        verticalAlign: 'bottom',
      }),
    ],
  });
  const headH = textH(2, s.headFont, 1.15);
  if (headline)
    rows.push({
      height: headH,
      gap: s.gap.headline,
      make: (y) => [
        text('headline', box(col.x, y, col.w, headH), headline, s.headFont, body, {
          lineHeight: 1.15,
          verticalAlign: 'top',
        }),
      ],
    });
  if (layout === 'portrait') {
    rows.push({
      height: cardSide,
      gap: s.gap.card,
      make: (y) => qrCard(ns, area.x + (area.w - cardSide) / 2, y, s, p),
    });
  }
  if (cta)
    rows.push({
      height: s.ctaH,
      gap: s.gap.cta,
      make: (y) => {
        const pill = box(within(s.ctaW), y, s.ctaW, s.ctaH);
        const inset = s.ctaH * 0.5;
        return [
          {
            ...common,
            ...pill,
            id: `${ns}cta-pill`,
            type: 'shape',
            shape: 'rect',
            fill: p.accent,
            stroke: null,
            strokeWidth: 0,
            cornerRadius: px(s.ctaH / 2),
          },
          text(
            'cta',
            box(within(s.ctaW) + inset, y, s.ctaW - 2 * inset, s.ctaH),
            cta,
            s.ctaFont,
            { ...body, weight: 700 },
            { color: p.onAccent, align: 'center' },
          ),
        ];
      },
    });
  const tag = o.hashtag?.trim();
  if (tag) {
    const tagH = textH(1, s.tagFont, 1.3);
    rows.push({
      height: tagH,
      gap: 0,
      make: (y) => [
        text(
          'hashtag',
          box(col.x, y, col.w, tagH),
          tag,
          s.tagFont,
          { ...body, weight: 700, tracking: 0.02 },
          { color: p.tag },
        ),
      ],
    });
  }

  const elements = stack(rows, top, bottom);
  if (layout === 'landscape')
    elements.push(...qrCard(ns, area.x + area.w - s.margin - cardSide, area.y + (area.h - cardSide) / 2, s, p));
  return elements;
}

/** The QR on a white card with an accent outline: the card is its quiet zone. */
function qrCard(ns: string, x: number, y: number, s: Spec, p: Palette): TemplateElement[] {
  const side = s.qr + 2 * s.pad;
  return [
    {
      ...common,
      ...box(x, y, side, side),
      id: `${ns}qr-card`,
      type: 'shape',
      shape: 'rect',
      fill: WHITE,
      stroke: p.accent,
      strokeWidth: px(1.2),
      cornerRadius: px(6),
    },
    {
      ...common,
      ...box(x + s.pad, y + s.pad, s.qr, s.qr),
      id: `${ns}qr`,
      type: 'qr',
      dark: p.qrDark,
      light: WHITE,
      // The gallery link has no short code to type.
      showCode: false,
    },
  ];
}

/**
 * The signage for an event, in canvas pixels at 300 DPI.
 *
 * The table tent is one A4 sheet holding two identical panels. The top one is the bottom one turned
 * 180° about the centre of the sheet, so once the sheet is folded on the dashed line both panels
 * read upright from their own side of the table.
 */
export function signageTemplate(format: SignageFormat, o: SignageOptions): Template {
  const p = palette(o.theme);
  const sheet = SIGNAGE_SHEET_MM[format];
  const { width: W, height: H } = signageSizePx(format);
  let elements: TemplateElement[];

  if (format === 'tent') {
    const half = sheet.height / 2;
    const lower = face('landscape', SPEC.tent, { x: 0, y: half, w: sheet.width, h: half }, o, p, 'bottom-');
    // Turn each element about the sheet's centre: its box lands opposite, and it turns about its own.
    const upper = lower.map((el): TemplateElement => ({
      ...el,
      id: el.id.replace(/^bottom-/, 'top-'),
      x: W - el.x - el.width,
      y: H - el.y - el.height,
      rotation: 180,
    }));
    // Dashes in sheet pixels, centred on the fold.
    const dash = px(4);
    const gap = px(3);
    const length = W - 2 * px(SPEC.tent.margin);
    const n = Math.floor((length + gap) / (dash + gap));
    const x0 = (W - (n * dash + (n - 1) * gap)) / 2;
    const thick = 4;
    const fold = Array.from({ length: n }, (_, i): TemplateElement => ({
      ...common,
      id: `fold-${i}`,
      type: 'shape',
      shape: 'rect',
      x: Math.round(x0 + i * (dash + gap)),
      y: H / 2 - thick / 2,
      width: dash,
      height: thick,
      fill: p.fold,
      stroke: null,
      strokeWidth: 0,
      cornerRadius: 0,
    }));
    elements = [...fold, ...lower, ...upper];
  } else {
    elements = face('portrait', SPEC[format], { x: 0, y: 0, w: sheet.width, h: sheet.height }, o, p, '');
  }

  return {
    canvas: { width: W, height: H, dpi: 300, printSize: null, background: p.background, backgroundAssetId: null },
    elements,
  };
}
