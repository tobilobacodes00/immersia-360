import type { PrintSize } from '../presets';
import {
  bottomBlock,
  box,
  centered,
  cols,
  grid,
  headerBlock,
  inset,
  keepOn,
  onCard,
  rows,
  slot,
  slots,
  snap,
  stickersFor,
  textBlock,
  type Box,
  type Deco,
  type Family,
  type Footer,
  type FooterMode,
  type Frame,
  type Geometry,
  type OrnamentZone,
  type PhotoSlot,
} from './geometry';

/**
 * The print layouts of the library (PHO-5): 59 photo arrangements across the six print sizes and one to
 * four shots each: stacks, grids, a hero with smaller shots, staggered and mosaic walls, tilted
 * instant-print cards, circles, film strips, side panels and a framed single. Prints (except the 9:16
 * story, which is for screens) carry the guest QR at 18 mm or more (DL-3), never touching a photo.
 */

export interface LayoutDef {
  /** Stable id, `[a-z0-9-]`: part of every template built on the layout. */
  id: string;
  size: PrintSize;
  family: Family;
  shots: number;
  build: (P: Frame) => Geometry;
}

const ones = (n: number) => Array<number>(n).fill(1);

/** Height of the title/QR footer for a mode. */
function footerHeight(P: Frame, mode: FooterMode): number {
  switch (mode) {
    case 'right':
    case 'left':
      return Math.max(P.plate + Math.round(P.u * 0.03), Math.round(P.H * 0.17));
    case 'stack':
      return P.plate + P.g + Math.round(P.u * 0.22);
    case 'center':
      return Math.round(P.H * 0.14);
  }
}

function footer(P: Frame, mode: FooterMode, crest = true, height?: number): Footer {
  return bottomBlock(P, { mode, height: height ?? footerHeight(P, mode), crest });
}

interface Extras {
  decos?: Deco[];
  ornaments?: OrnamentZone[];
  stickers?: boolean;
  border?: boolean;
}

function fromFooter(P: Frame, f: Footer, photos: PhotoSlot[], x: Extras = {}): Geometry {
  return snap({
    photos,
    decos: [f.rule, ...(x.decos ?? [])],
    title: f.title,
    subtitle: f.subtitle,
    textBox: f.textBox,
    qrs: f.qr ? [f.qr] : [],
    ornaments: [
      ...(f.crest ? [f.crest] : []),
      ...(x.stickers === false ? [] : stickersFor(P, f.area)),
      ...(x.ornaments ?? []),
    ],
    border: x.border ?? true,
  });
}

function fromHeader(
  P: Frame,
  o: { headerHeight: number; qr: boolean },
  photos: (area: Box) => PhotoSlot[],
  x: Extras = {},
) {
  const h = headerBlock(P, { headerHeight: o.headerHeight, qr: o.qr, crest: true });
  return snap({
    photos: photos(h.area),
    decos: [...h.rules, ...(x.decos ?? [])],
    title: h.title,
    subtitle: h.subtitle,
    textBox: h.textBox,
    qrs: h.qr ? [h.qr] : [],
    ornaments: [
      ...(h.crest ? [h.crest] : []),
      ...(x.stickers === false ? [] : stickersFor(P, h.area)),
      ...(x.ornaments ?? []),
    ],
    border: x.border ?? true,
  });
}

/** The biggest `ratio` (width / height) box that fits `within`, centred. */
function fitRatio(within: Box, ratio: number): Box {
  let w = within.width;
  let h = w / ratio;
  if (h > within.height) {
    h = within.height;
    w = h * ratio;
  }
  return centered(within, w, h);
}

/** A circular photo (a square slot rounded to its half side) and its ring. */
function circle(shot: number, cell: Box, scale = 0.94): { photo: PhotoSlot; ring: Deco } {
  const side = Math.min(cell.width, cell.height) * scale;
  const b = centered(cell, side, side);
  const stroke = Math.max(3, side * 0.014);
  const out = stroke * 1.8 + 4;
  return {
    photo: slot(shot, b, { radius: side / 2, plain: true }),
    ring: {
      role: 'line',
      shape: 'ellipse',
      ...box(b.x - out, b.y - out, b.width + 2 * out, b.height + 2 * out),
      stroke,
      front: true,
    },
  };
}

/** An instant-print card at `deg` degrees with its photo inside, and a soft shadow beneath. */
function card(shot: number, c: Box, deg: number): { photo: PhotoSlot; decos: Deco[] } {
  const pad = Math.round(c.width * 0.07);
  const caption = Math.round(c.height * 0.2);
  const inner = box(c.x + pad, c.y + pad, c.width - 2 * pad, c.height - pad - caption);
  const radius = Math.round(c.width * 0.012);
  return {
    decos: [
      { role: 'shade', ...box(c.x + 7, c.y + 12, c.width, c.height), rotation: deg, radius },
      { role: 'paper', ...c, rotation: deg, radius },
    ],
    photo: slot(shot, onCard(c, deg, inner), { radius: 0, plain: true }),
  };
}

/** A card sized for `cell` (kept off its edges so a tilted corner stays on the page), shifted sideways. */
function cardIn(cell: Box, ratio: number, shift = 0): Box {
  const b = fitRatio(inset(cell, Math.min(cell.width, cell.height) * 0.03), ratio);
  return { ...b, x: b.x + shift * (cell.width - b.width) };
}

function cards(boxes: Box[], tilts: number[]): { photos: PhotoSlot[]; decos: Deco[] } {
  const made = boxes.map((b, i) => card(i, b, tilts[i % tilts.length] ?? 0));
  return { photos: made.map((m) => m.photo), decos: made.flatMap((m) => m.decos) };
}

/** Film strip running down `A`: sprocket holes on both long edges, `n` frames between them. */
function filmDown(P: Frame, A: Box, n: number): { decos: Deco[]; photos: PhotoSlot[] } {
  const pw = Math.round(A.width * 0.1);
  const gv = Math.round(P.g * 0.8);
  const frames = rows(box(A.x + pw, A.y + gv, A.width - 2 * pw, A.height - 2 * gv), ones(n), gv);
  const hh = Math.round(pw * 0.62);
  const hw = Math.round(pw * 0.46);
  const pitch = Math.round(hh * 1.95);
  const count = Math.floor(A.height / pitch);
  const start = A.y + (A.height - count * pitch) / 2 + (pitch - hh) / 2;
  const decos: Deco[] = [{ role: 'film', ...A, radius: Math.round(P.u * 0.012) }];
  for (const x of [A.x + (pw - hw) / 2, A.x + A.width - pw + (pw - hw) / 2])
    for (let i = 0; i < count; i++)
      decos.push({ role: 'hole', ...box(x, start + i * pitch, hw, hh), radius: Math.round(hh * 0.22) });
  return { decos, photos: frames.map((b, i) => slot(i, b, { radius: 0, plain: true })) };
}

/** Film strip running along `A`: sprocket holes top and bottom, `n` frames between them. */
function filmAcross(P: Frame, A: Box, n: number): { decos: Deco[]; photos: PhotoSlot[] } {
  const ph = Math.round(A.height * 0.1);
  const gh = Math.round(P.g * 0.8);
  const frames = cols(box(A.x + gh, A.y + ph, A.width - 2 * gh, A.height - 2 * ph), ones(n), gh);
  const hw = Math.round(ph * 0.62);
  const hh = Math.round(ph * 0.46);
  const pitch = Math.round(hw * 1.95);
  const count = Math.floor(A.width / pitch);
  const start = A.x + (A.width - count * pitch) / 2 + (pitch - hw) / 2;
  const decos: Deco[] = [{ role: 'film', ...A, radius: Math.round(P.u * 0.012) }];
  for (const y of [A.y + (ph - hh) / 2, A.y + A.height - ph + (ph - hh) / 2])
    for (let i = 0; i < count; i++)
      decos.push({ role: 'hole', ...box(start + i * pitch, y, hw, hh), radius: Math.round(hh * 0.22) });
  return { decos, photos: frames.map((b, i) => slot(i, b, { radius: 0, plain: true })) };
}

/** A side panel with the title, date and QR, and the space left for photos beside it. */
function sidePanel(P: Frame, pw: number) {
  const panel = box(P.W - P.m - pw, P.m, pw, P.H - 2 * P.m);
  const qr = box(panel.x + (pw - P.side) / 2, panel.y + panel.height - P.plate, P.side, P.plate);
  const free = panel.height - P.plate - P.g;
  const th = Math.min(free, Math.round(P.u * 0.5));
  const T = box(panel.x, panel.y + (free - th) / 2, pw, th);
  const tb = textBlock(P.u, T, { align: 'center', crest: true });
  return {
    area: box(P.m, P.m, P.W - 2 * P.m - pw - P.g, panel.height),
    qr,
    textBox: T,
    rule: { role: 'rule', ...box(panel.x - Math.round(P.g / 2) - 1, panel.y, 2, panel.height) } satisfies Deco,
    ...tb,
  };
}

function fromPanel(P: Frame, s: ReturnType<typeof sidePanel>, photos: PhotoSlot[], x: Extras = {}): Geometry {
  return snap({
    photos,
    decos: [s.rule, ...(x.decos ?? [])],
    title: s.title,
    subtitle: s.subtitle,
    textBox: s.textBox,
    qrs: [s.qr],
    ornaments: [
      ...(s.crest ? [s.crest] : []),
      ...(x.stickers === false ? [] : stickersFor(P, s.area)),
      ...(x.ornaments ?? []),
    ],
    border: x.border ?? true,
  });
}

/** Four corner brackets round a box, turned for each corner. */
function cornersAround(b: Box, s: number): OrnamentZone[] {
  const o = s * 0.1;
  return [
    { role: 'corner', ...box(b.x - o, b.y - o, s, s), rotation: 0 },
    { role: 'corner', ...box(b.x + b.width - s + o, b.y - o, s, s), rotation: 90 },
    { role: 'corner', ...box(b.x + b.width - s + o, b.y + b.height - s + o, s, s), rotation: 180 },
    { role: 'corner', ...box(b.x - o, b.y + b.height - s + o, s, s), rotation: 270 },
  ];
}

const DEFS: LayoutDef[] = [];
const def = (id: string, size: PrintSize, family: Family, shots: number, build: (P: Frame) => Geometry) =>
  DEFS.push({ id, size, family, shots, build });

/* ------------------------------------------------------------------ 2×6: 600 × 1800 */

def('2x6-stack-3', '2x6', 'stack', 3, (P) => {
  const f = footer(P, 'stack');
  return fromFooter(P, f, slots(rows(f.area, ones(3), P.g)));
});

def('2x6-stack-4', '2x6', 'stack', 4, (P) => {
  const f = footer(P, 'right', false);
  return fromFooter(P, f, slots(rows(f.area, ones(4), P.g)));
});

def('2x6-stack-2', '2x6', 'duo', 2, (P) => {
  const f = footer(P, 'stack');
  return fromFooter(P, f, slots(rows(f.area, ones(2), P.g)));
});

def('2x6-single-1', '2x6', 'single', 1, (P) => {
  const f = footer(P, 'right', false);
  return fromFooter(P, f, [slot(0, f.area)]);
});

def('2x6-hero-3', '2x6', 'hero', 3, (P) => {
  const f = footer(P, 'right', false);
  const [hero, low] = rows(f.area, [1.5, 1], P.g) as [Box, Box];
  return fromFooter(P, f, slots([hero, ...cols(low, [1, 1], P.g)]));
});

def('2x6-stagger-4', '2x6', 'stagger', 4, (P) => {
  const f = footer(P, 'right', false);
  const w = Math.round(f.area.width * 0.78);
  return fromFooter(
    P,
    f,
    slots(rows(f.area, ones(4), P.g).map((r, i) => box(i % 2 ? r.x + r.width - w : r.x, r.y, w, r.height))),
  );
});

def('2x6-film-4', '2x6', 'film', 4, (P) => {
  const f = footer(P, 'right', false);
  const film = filmDown(P, f.area, 4);
  return fromFooter(P, f, film.photos, { decos: film.decos, stickers: false, border: false });
});

def('2x6-polaroid-3', '2x6', 'polaroid', 3, (P) => {
  const f = footer(P, 'right', false);
  const cells = rows(f.area, ones(3), P.g);
  const c = cards(
    cells.map((cell, i) => cardIn(cell, 0.88, i % 2 ? 0.38 : -0.38)),
    [-3, 2.5, -2],
  );
  return fromFooter(P, f, c.photos, { decos: c.decos, stickers: false, border: false });
});

def('2x6-circles-3', '2x6', 'circles', 3, (P) => {
  const f = footer(P, 'right', false);
  const c = rows(f.area, ones(3), P.g).map((cell, i) => circle(i, cell));
  return fromFooter(
    P,
    f,
    c.map((x) => x.photo),
    { decos: c.map((x) => x.ring), stickers: false },
  );
});

def('2x6-header-3', '2x6', 'header', 3, (P) =>
  fromHeader(P, { headerHeight: Math.round(P.H * 0.15), qr: true }, (area) => slots(rows(area, ones(3), P.g))),
);

/* ------------------------------------------------------------------ 4×4: 1200 × 1200 */

def('4x4-grid-4', '4x4', 'grid', 4, (P) => {
  const f = footer(P, 'right');
  return fromFooter(P, f, slots(grid(f.area, 2, 2, P.g)));
});

def('4x4-hero-3', '4x4', 'hero', 3, (P) => {
  const f = footer(P, 'right');
  const [left, right] = cols(f.area, [1, 1], P.g) as [Box, Box];
  return fromFooter(P, f, slots([left, ...rows(right, [1, 1], P.g)]));
});

def('4x4-duo-2', '4x4', 'duo', 2, (P) => {
  const f = footer(P, 'left');
  return fromFooter(P, f, slots(cols(f.area, [1, 1], P.g)));
});

def('4x4-single-1', '4x4', 'single', 1, (P) => {
  const f = footer(P, 'right');
  return fromFooter(P, f, [slot(0, f.area)]);
});

def('4x4-polaroid-3', '4x4', 'polaroid', 3, (P) => {
  const f = footer(P, 'right');
  const cells = cols(f.area, ones(3), P.g * 0.5);
  const c = cards(
    cells.map((cell, i) => {
      const b = cardIn(cell, 0.84);
      return { ...b, y: b.y + (i % 2 ? 1 : -1) * cell.height * 0.05 };
    }),
    [-4, 3, -2],
  );
  return fromFooter(P, f, c.photos, { decos: c.decos, stickers: false, border: false });
});

def('4x4-circles-4', '4x4', 'circles', 4, (P) => {
  const f = footer(P, 'right');
  const d = (f.area.height - P.g) / 2;
  const block = centered(f.area, d * 2 + P.g, f.area.height);
  const c = grid(block, 2, 2, P.g).map((cell, i) => circle(i, cell, 1));
  const free = (f.area.width - block.width) / 2;
  const fs = Math.round(Math.min(free * 0.7, P.u * 0.11));
  const mid = f.area.y + f.area.height / 2 - fs / 2;
  return fromFooter(
    P,
    f,
    c.map((x) => x.photo),
    {
      decos: c.map((x) => x.ring),
      stickers: false,
      ornaments: [
        { role: 'feature', ...box(f.area.x + (free - fs) / 2, mid, fs, fs) },
        { role: 'feature', ...box(f.area.x + f.area.width - free + (free - fs) / 2, mid, fs, fs) },
      ],
    },
  );
});

def('4x4-column-3', '4x4', 'panel', 3, (P) => {
  const s = sidePanel(P, 300);
  return fromPanel(P, s, slots(rows(s.area, ones(3), P.g)));
});

def('4x4-header-duo-2', '4x4', 'header', 2, (P) =>
  fromHeader(P, { headerHeight: Math.round(P.H * 0.14), qr: true }, (area) => slots(cols(area, [1, 1], P.g))),
);

def('4x4-frame-1', '4x4', 'frame', 1, (P) => {
  const f = footer(P, 'right', true, P.plate + 4);
  const photo = fitRatio(f.area, 1);
  const free = (f.area.width - photo.width) / 2;
  const fs = Math.round(Math.min(free * 0.7, P.u * 0.11));
  return fromFooter(P, f, [slot(0, photo)], {
    stickers: false,
    ornaments: [
      ...cornersAround(photo, Math.round(P.u * 0.1)),
      { role: 'feature', ...box(f.area.x + (free - fs) / 2, photo.y + photo.height / 2 - fs / 2, fs, fs) },
      { role: 'feature', ...box(photo.x + photo.width + (free - fs) / 2, photo.y + photo.height / 2 - fs / 2, fs, fs) },
    ],
  });
});

/* ------------------------------------------------------------------ 4×6: 1200 × 1800 */

def('4x6-grid-4', '4x6', 'grid', 4, (P) => {
  const f = footer(P, 'right');
  return fromFooter(P, f, slots(grid(f.area, 2, 2, P.g)));
});

def('4x6-hero-3', '4x6', 'hero', 3, (P) => {
  const f = footer(P, 'right');
  const [hero, low] = rows(f.area, [1.15, 1], P.g) as [Box, Box];
  return fromFooter(P, f, slots([hero, ...cols(low, [1, 1], P.g)]));
});

def('4x6-hero-bottom-3', '4x6', 'hero', 3, (P) => {
  const f = footer(P, 'left');
  const [top, hero] = rows(f.area, [1, 1.15], P.g) as [Box, Box];
  return fromFooter(P, f, slots([...cols(top, [1, 1], P.g), hero]));
});

def('4x6-stack-3', '4x6', 'stack', 3, (P) => {
  const f = footer(P, 'right');
  return fromFooter(P, f, slots(rows(f.area, ones(3), P.g)));
});

def('4x6-stack-2', '4x6', 'duo', 2, (P) => {
  const f = footer(P, 'stack');
  return fromFooter(P, f, slots(rows(f.area, ones(2), P.g)));
});

def('4x6-single-1', '4x6', 'single', 1, (P) => {
  const f = footer(P, 'right');
  return fromFooter(P, f, [slot(0, f.area)]);
});

def('4x6-polaroid-3', '4x6', 'polaroid', 3, (P) => {
  const f = footer(P, 'right');
  const [top, bottom] = rows(f.area, [1, 1], P.g) as [Box, Box];
  const [a, b] = cols(top, [1, 1], P.g) as [Box, Box];
  const c = cards([cardIn(a, 0.82), cardIn(b, 0.82), cardIn(bottom, 0.82)], [-3, 3, -1.5]);
  return fromFooter(P, f, c.photos, { decos: c.decos, stickers: false, border: false });
});

def('4x6-circles-4', '4x6', 'circles', 4, (P) => {
  const f = footer(P, 'right');
  const c = grid(f.area, 2, 2, P.g).map((cell, i) => circle(i, cell, 0.96));
  return fromFooter(
    P,
    f,
    c.map((x) => x.photo),
    { decos: c.map((x) => x.ring), stickers: false },
  );
});

def('4x6-mosaic-4', '4x6', 'mosaic', 4, (P) => {
  const f = footer(P, 'right');
  const [l, r] = cols(f.area, [1, 1], P.g) as [Box, Box];
  return fromFooter(P, f, slots([...rows(l, [1.25, 1], P.g), ...rows(r, [1, 1.25], P.g)]));
});

def('4x6-header-hero-3', '4x6', 'header', 3, (P) =>
  fromHeader(P, { headerHeight: Math.round(P.H * 0.17), qr: true }, (area) => {
    const [hero, low] = rows(area, [1.1, 1], P.g) as [Box, Box];
    return slots([hero, ...cols(low, [1, 1], P.g)]);
  }),
);

/* ------------------------------------------------------------------ 5×7: 1500 × 2100 */

def('5x7-grid-4', '5x7', 'grid', 4, (P) => {
  const f = footer(P, 'right');
  return fromFooter(P, f, slots(grid(f.area, 2, 2, P.g)));
});

def('5x7-hero-3', '5x7', 'hero', 3, (P) => {
  const f = footer(P, 'right');
  const [hero, low] = rows(f.area, [1.2, 1], P.g) as [Box, Box];
  return fromFooter(P, f, slots([hero, ...cols(low, [1, 1], P.g)]));
});

def('5x7-stack-3', '5x7', 'stack', 3, (P) => {
  const f = footer(P, 'right');
  return fromFooter(P, f, slots(rows(f.area, ones(3), P.g)));
});

def('5x7-stack-2', '5x7', 'duo', 2, (P) => {
  const f = footer(P, 'stack');
  return fromFooter(P, f, slots(rows(f.area, ones(2), P.g)));
});

def('5x7-single-1', '5x7', 'single', 1, (P) => {
  const f = footer(P, 'right');
  return fromFooter(P, f, [slot(0, f.area)]);
});

def('5x7-polaroid-4', '5x7', 'polaroid', 4, (P) => {
  const f = footer(P, 'right');
  const c = cards(
    grid(f.area, 2, 2, P.g).map((cell) => cardIn(cell, 0.88)),
    [-2.5, 2, 2.5, -2],
  );
  return fromFooter(P, f, c.photos, { decos: c.decos, stickers: false, border: false });
});

def('5x7-circles-3', '5x7', 'circles', 3, (P) => {
  const f = footer(P, 'right');
  const d = Math.min((f.area.width - P.g) / 2, (f.area.height - P.g) / 2);
  const block = centered(f.area, d * 2 + P.g, d * 2 + P.g);
  const top = box(block.x + (block.width - d) / 2, block.y, d, d);
  const bottom = cols(box(block.x, block.y + d + P.g, block.width, d), [1, 1], P.g) as [Box, Box];
  const c = [top, ...bottom].map((cell, i) => circle(i, cell, 1));
  return fromFooter(
    P,
    f,
    c.map((x) => x.photo),
    { decos: c.map((x) => x.ring), stickers: false },
  );
});

def('5x7-stagger-4', '5x7', 'stagger', 4, (P) => {
  const f = footer(P, 'right');
  const [l, r] = cols(f.area, [1, 1], P.g) as [Box, Box];
  const h = (f.area.height - P.g) / 2.35;
  const drop = h * 0.35;
  const at = (c: Box, i: number, dy: number) => box(c.x, c.y + dy + i * (h + P.g), c.width, h);
  return fromFooter(P, f, slots([at(l, 0, 0), at(r, 0, drop), at(l, 1, 0), at(r, 1, drop)]));
});

def('5x7-header-hero-3', '5x7', 'header', 3, (P) =>
  fromHeader(P, { headerHeight: Math.round(P.H * 0.15), qr: true }, (area) => {
    const [hero, low] = rows(area, [1.2, 1], P.g) as [Box, Box];
    return slots([hero, ...cols(low, [1, 1], P.g)]);
  }),
);

def('5x7-frame-1', '5x7', 'frame', 1, (P) => {
  const f = footer(P, 'right');
  const photo = fitRatio(inset(f.area, P.g), 0.8);
  return fromFooter(P, f, [slot(0, photo)], {
    stickers: false,
    ornaments: cornersAround(photo, Math.round(P.u * 0.085)),
  });
});

/* ------------------------------------------------------------------ 6×4: 1800 × 1200 */

def('6x4-row-3', '6x4', 'row', 3, (P) => {
  const f = footer(P, 'right');
  return fromFooter(P, f, slots(cols(f.area, ones(3), P.g)));
});

def('6x4-row-4', '6x4', 'row', 4, (P) => {
  const f = footer(P, 'left');
  return fromFooter(P, f, slots(cols(f.area, ones(4), P.g)));
});

def('6x4-panel-4', '6x4', 'panel', 4, (P) => {
  const s = sidePanel(P, 360);
  return fromPanel(P, s, slots(grid(s.area, 2, 2, P.g)));
});

def('6x4-hero-3', '6x4', 'hero', 3, (P) => {
  const f = footer(P, 'right');
  const [hero, right] = cols(f.area, [1.35, 1], P.g) as [Box, Box];
  return fromFooter(P, f, slots([hero, ...rows(right, [1, 1], P.g)]));
});

def('6x4-duo-2', '6x4', 'duo', 2, (P) => {
  const f = footer(P, 'left');
  return fromFooter(P, f, slots(cols(f.area, [1, 1], P.g)));
});

def('6x4-single-1', '6x4', 'single', 1, (P) => {
  const f = footer(P, 'right');
  return fromFooter(P, f, [slot(0, f.area)]);
});

def('6x4-film-4', '6x4', 'film', 4, (P) => {
  const f = footer(P, 'right');
  const film = filmAcross(P, f.area, 4);
  return fromFooter(P, f, film.photos, { decos: film.decos, stickers: false, border: false });
});

def('6x4-polaroid-3', '6x4', 'polaroid', 3, (P) => {
  const f = footer(P, 'right');
  const c = cards(
    cols(f.area, ones(3), P.g).map((cell) => cardIn(cell, 0.86)),
    [-3, 2, -2.5],
  );
  return fromFooter(P, f, c.photos, { decos: c.decos, stickers: false, border: false });
});

def('6x4-circles-3', '6x4', 'circles', 3, (P) => {
  const f = footer(P, 'right');
  const c = cols(f.area, ones(3), P.g).map((cell, i) => circle(i, cell, 0.96));
  return fromFooter(
    P,
    f,
    c.map((x) => x.photo),
    { decos: c.map((x) => x.ring), stickers: false },
  );
});

def('6x4-panel-hero-3', '6x4', 'panel', 3, (P) => {
  const s = sidePanel(P, 360);
  const [hero, low] = rows(s.area, [1.15, 1], P.g) as [Box, Box];
  return fromPanel(P, s, slots([hero, ...cols(low, [1, 1], P.g)]));
});

/* ------------------------------------------------------------------ story: 1080 × 1920 (no QR: it is for screens) */

def('story-stack-4', 'story', 'stack', 4, (P) => {
  const f = footer(P, 'center');
  return fromFooter(P, f, slots(rows(f.area, ones(4), P.g)));
});

def('story-stack-3', 'story', 'stack', 3, (P) => {
  const f = footer(P, 'center');
  return fromFooter(P, f, slots(rows(f.area, ones(3), P.g)));
});

def('story-stack-2', 'story', 'duo', 2, (P) => {
  const f = footer(P, 'center');
  return fromFooter(P, f, slots(rows(f.area, ones(2), P.g)));
});

def('story-single-1', 'story', 'single', 1, (P) => {
  const f = footer(P, 'center');
  return fromFooter(P, f, [slot(0, f.area)]);
});

def('story-hero-3', 'story', 'hero', 3, (P) => {
  const f = footer(P, 'center');
  const [hero, low] = rows(f.area, [1.25, 1], P.g) as [Box, Box];
  return fromFooter(P, f, slots([hero, ...cols(low, [1, 1], P.g)]));
});

def('story-grid-4', 'story', 'grid', 4, (P) => {
  const f = footer(P, 'center');
  return fromFooter(P, f, slots(grid(f.area, 2, 2, P.g)));
});

def('story-polaroid-3', 'story', 'polaroid', 3, (P) => {
  const f = footer(P, 'center');
  const h = Math.round(f.area.height * 0.38);
  const w = Math.round(h * 0.9);
  const step = (f.area.height - h) / 2;
  const xs = [f.area.x, f.area.x + (f.area.width - w) / 2, f.area.x + f.area.width - w];
  const c = cards(
    xs.map((x, i) => box(x, f.area.y + i * step, w, h)),
    [-3, 2, -2],
  );
  return fromFooter(P, f, c.photos, { decos: c.decos, stickers: false, border: false });
});

def('story-circles-3', 'story', 'circles', 3, (P) => {
  const f = footer(P, 'center');
  const d = (f.area.height - 2 * P.g) / 3;
  const xs = [f.area.x, f.area.x + (f.area.width - d) / 2, f.area.x + f.area.width - d];
  const c = xs.map((x, i) => circle(i, box(x, f.area.y + i * (d + P.g), d, d), 0.94));
  return fromFooter(
    P,
    f,
    c.map((x) => x.photo),
    { decos: c.map((x) => x.ring), stickers: false },
  );
});

def('story-header-stack-3', 'story', 'header', 3, (P) =>
  fromHeader(P, { headerHeight: Math.round(P.H * 0.15), qr: false }, (area) => slots(rows(area, ones(3), P.g))),
);

def('story-fullbleed-1', 'story', 'fullbleed', 1, (P) => {
  const ph = Math.round(P.H * 0.16);
  const plate = box(P.m, P.H - P.m - ph, P.W - 2 * P.m, ph);
  const tb = textBlock(P.u, inset(plate, Math.round(P.u * 0.03)), { align: 'center', crest: true });
  const s = Math.round(P.u * 0.12);
  return snap({
    photos: [slot(0, box(0, 0, P.W, P.H), { radius: 0, plain: true })],
    decos: [{ role: 'tint', ...plate, radius: Math.round(P.u * 0.03), front: true }],
    title: tb.title,
    subtitle: tb.subtitle,
    textBox: null,
    qrs: [],
    ornaments: [
      ...(tb.crest ? [tb.crest] : []),
      { role: 'sticker', ...keepOn(box(P.m, P.m, s, s), P.W, P.H) },
      { role: 'sticker', ...keepOn(box(P.W - P.m - s, P.m, s, s), P.W, P.H) },
    ],
    border: false,
  });
});

export const PRINT_LAYOUT_DEFS: readonly LayoutDef[] = DEFS;
