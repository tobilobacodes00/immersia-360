import type { ORNAMENTS } from '@immersia/shared';

/**
 * Decorations for templates (PHO-5's library, and anyone's own designs): original vector shapes
 * drawn in a unit box, filled with one colour. Code rather than files, so built-in templates need no
 * assets, scale to any print size and work offline. Every shape is a filled path (even-odd where it
 * has holes), drawn into a 1×1 box and scaled by the renderer to the element (aspect kept, centred).
 */
export type Ornament = (typeof ORNAMENTS)[number];

type Path = {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
  quadraticCurveTo(a: number, b: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw?: boolean): void;
  rect(x: number, y: number, w: number, h: number): void;
  closePath(): void;
};

const TAU = Math.PI * 2;

/** A closed star/burst: `points` tips between radii `r1` (outer) and `r2` (inner). */
function star(p: Path, cx: number, cy: number, points: number, r1: number, r2: number, rot = -Math.PI / 2) {
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = rot + (i * Math.PI) / points;
    if (i === 0) p.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    else p.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  p.closePath();
}

function heart(p: Path, cx: number, cy: number, s: number) {
  p.moveTo(cx, cy + 0.42 * s);
  p.bezierCurveTo(cx - 0.62 * s, cy - 0.02 * s, cx - 0.4 * s, cy - 0.52 * s, cx, cy - 0.22 * s);
  p.bezierCurveTo(cx + 0.4 * s, cy - 0.52 * s, cx + 0.62 * s, cy - 0.02 * s, cx, cy + 0.42 * s);
  p.closePath();
}

function circle(p: Path, cx: number, cy: number, r: number) {
  p.moveTo(cx + r, cy);
  p.arc(cx, cy, r, 0, TAU);
  p.closePath();
}

function leaf(p: Path, x: number, y: number, len: number, angle: number, width = 0.38) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const tip = [x + c * len, y + s * len] as const;
  const w = len * width;
  const nx = -s * w;
  const ny = c * w;
  const mid = [x + c * len * 0.5, y + s * len * 0.5] as const;
  p.moveTo(x, y);
  p.quadraticCurveTo(mid[0] + nx, mid[1] + ny, tip[0], tip[1]);
  p.quadraticCurveTo(mid[0] - nx, mid[1] - ny, x, y);
  p.closePath();
}

export const ORNAMENT_PATHS: Record<Ornament, (p: Path) => void> = {
  heart: (p) => heart(p, 0.5, 0.52, 1),
  hearts: (p) => {
    heart(p, 0.36, 0.55, 0.62);
    heart(p, 0.68, 0.4, 0.42);
  },
  star: (p) => star(p, 0.5, 0.54, 5, 0.48, 0.2),
  sparkle: (p) => {
    star(p, 0.42, 0.55, 4, 0.4, 0.07);
    star(p, 0.8, 0.2, 4, 0.16, 0.03);
  },
  burst: (p) => star(p, 0.5, 0.5, 12, 0.48, 0.34),
  rings: (p) => {
    // Two interlocked bands (even-odd: each ring is an outer minus an inner circle).
    for (const cx of [0.38, 0.62]) {
      circle(p, cx, 0.5, 0.26);
      circle(p, cx, 0.5, 0.2);
    }
  },
  laurel: (p) => {
    // Two sprays curving up and out from the bottom centre; leaves lean outwards, less so near the top.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const x = 0.5 + side * (0.08 + Math.sin(t * 1.3) * 0.3);
        const y = 0.9 - t * 0.72;
        leaf(p, x, y, 0.16, -Math.PI / 2 + side * (0.9 - t * 0.5), 0.42);
      }
    }
  },
  leaf: (p) => leaf(p, 0.15, 0.85, 0.95, -Math.PI / 4, 0.36),
  flower: (p) => {
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6;
      p.moveTo(0.5, 0.5);
      p.ellipse(0.5 + Math.cos(a) * 0.22, 0.5 + Math.sin(a) * 0.22, 0.2, 0.12, a, 0, TAU);
      p.closePath();
    }
    circle(p, 0.5, 0.5, 0.11);
  },
  balloon: (p) => {
    p.moveTo(0.5, 0.08);
    p.bezierCurveTo(0.8, 0.08, 0.86, 0.42, 0.62, 0.66);
    p.lineTo(0.56, 0.72);
    p.lineTo(0.6, 0.76);
    p.lineTo(0.4, 0.76);
    p.lineTo(0.44, 0.72);
    p.lineTo(0.38, 0.66);
    p.bezierCurveTo(0.14, 0.42, 0.2, 0.08, 0.5, 0.08);
    p.closePath();
    p.rect(0.49, 0.76, 0.02, 0.2);
  },
  balloons: (p) => {
    for (const [x, y, s] of [
      [0.3, 0.32, 0.5],
      [0.62, 0.22, 0.46],
      [0.52, 0.5, 0.42],
    ] as const) {
      p.moveTo(x, y - s * 0.42);
      p.bezierCurveTo(x + s * 0.6, y - s * 0.42, x + s * 0.5, y + s * 0.3, x, y + s * 0.42);
      p.bezierCurveTo(x - s * 0.5, y + s * 0.3, x - s * 0.6, y - s * 0.42, x, y - s * 0.42);
      p.closePath();
      p.rect(x - 0.006, y + s * 0.42, 0.012, 0.98 - y - s * 0.42);
    }
  },
  confetti: (p) => {
    // A fixed scatter (no randomness: the same design prints the same way).
    const bits: [number, number, number][] = [
      [0.12, 0.2, 0.3],
      [0.3, 0.1, 1.2],
      [0.55, 0.22, 0.6],
      [0.82, 0.12, 2.1],
      [0.2, 0.5, 2.6],
      [0.45, 0.42, 0.1],
      [0.7, 0.48, 1.7],
      [0.9, 0.4, 0.9],
      [0.1, 0.82, 1.4],
      [0.38, 0.72, 2.2],
      [0.62, 0.8, 0.4],
      [0.86, 0.75, 1.0],
    ];
    for (const [x, y, a] of bits) {
      const c = Math.cos(a) * 0.05;
      const s = Math.sin(a) * 0.05;
      p.moveTo(x - c + s * 0.4, y - s - c * 0.4);
      p.lineTo(x + c + s * 0.4, y + s - c * 0.4);
      p.lineTo(x + c - s * 0.4, y + s + c * 0.4);
      p.lineTo(x - c - s * 0.4, y - s + c * 0.4);
      p.closePath();
    }
  },
  crown: (p) => {
    p.moveTo(0.1, 0.78);
    p.lineTo(0.1, 0.32);
    p.lineTo(0.3, 0.52);
    p.lineTo(0.5, 0.22);
    p.lineTo(0.7, 0.52);
    p.lineTo(0.9, 0.32);
    p.lineTo(0.9, 0.78);
    p.closePath();
  },
  'grad-cap': (p) => {
    p.moveTo(0.5, 0.2);
    p.lineTo(0.95, 0.38);
    p.lineTo(0.5, 0.56);
    p.lineTo(0.05, 0.38);
    p.closePath();
    p.moveTo(0.24, 0.48);
    p.lineTo(0.24, 0.66);
    p.bezierCurveTo(0.36, 0.78, 0.64, 0.78, 0.76, 0.66);
    p.lineTo(0.76, 0.48);
    p.lineTo(0.5, 0.58);
    p.closePath();
    p.rect(0.86, 0.38, 0.02, 0.3);
    p.rect(0.84, 0.68, 0.06, 0.08);
  },
  cake: (p) => {
    p.rect(0.18, 0.5, 0.64, 0.38);
    p.rect(0.28, 0.32, 0.44, 0.18);
    for (const x of [0.38, 0.5, 0.62]) {
      p.rect(x - 0.012, 0.18, 0.024, 0.14);
      p.moveTo(x, 0.08);
      p.quadraticCurveTo(x + 0.035, 0.14, x, 0.17);
      p.quadraticCurveTo(x - 0.035, 0.14, x, 0.08);
      p.closePath();
    }
  },
  gift: (p) => {
    p.rect(0.14, 0.42, 0.72, 0.48);
    p.rect(0.1, 0.3, 0.8, 0.14);
    p.moveTo(0.5, 0.3);
    p.bezierCurveTo(0.34, 0.08, 0.16, 0.22, 0.32, 0.3);
    p.closePath();
    p.moveTo(0.5, 0.3);
    p.bezierCurveTo(0.66, 0.08, 0.84, 0.22, 0.68, 0.3);
    p.closePath();
  },
  champagne: (p) => {
    for (const [x, tilt] of [
      [0.36, -0.12],
      [0.64, 0.12],
    ] as const) {
      p.moveTo(x - 0.12 + tilt, 0.1);
      p.lineTo(x + 0.12 + tilt, 0.1);
      p.bezierCurveTo(x + 0.12 + tilt, 0.42, x + 0.04, 0.5, x + 0.02, 0.56);
      p.lineTo(x + 0.02, 0.86);
      p.lineTo(x + 0.12, 0.9);
      p.lineTo(x - 0.12, 0.9);
      p.lineTo(x - 0.02, 0.86);
      p.lineTo(x - 0.02, 0.56);
      p.bezierCurveTo(x - 0.04, 0.5, x - 0.12 + tilt, 0.42, x - 0.12 + tilt, 0.1);
      p.closePath();
    }
  },
  snowflake: (p) => {
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const arm = (r: number, w: number, len: number) => {
        const x = 0.5 + c * r;
        const y = 0.5 + s * r;
        p.moveTo(x - s * w, y + c * w);
        p.lineTo(x + c * len - s * w, y + s * len + c * w);
        p.lineTo(x + c * len + s * w, y + s * len - c * w);
        p.lineTo(x + s * w, y - c * w);
        p.closePath();
      };
      arm(0, 0.025, 0.45);
      // Side branches.
      for (const [r, turn] of [
        [0.22, 1],
        [0.22, -1],
      ] as const) {
        const bx = 0.5 + c * r;
        const by = 0.5 + s * r;
        const ba = a + turn * 0.8;
        p.moveTo(bx, by);
        p.lineTo(bx + Math.cos(ba) * 0.14 - Math.sin(ba) * 0.02, by + Math.sin(ba) * 0.14 + Math.cos(ba) * 0.02);
        p.lineTo(bx + Math.cos(ba) * 0.14 + Math.sin(ba) * 0.02, by + Math.sin(ba) * 0.14 - Math.cos(ba) * 0.02);
        p.closePath();
      }
    }
    circle(p, 0.5, 0.5, 0.06);
  },
  tree: (p) => {
    for (const [top, w] of [
      [0.08, 0.2],
      [0.26, 0.28],
      [0.44, 0.36],
    ] as const) {
      p.moveTo(0.5, top);
      p.lineTo(0.5 + w, top + 0.3);
      p.lineTo(0.5 - w, top + 0.3);
      p.closePath();
    }
    p.rect(0.44, 0.74, 0.12, 0.16);
  },
  bauble: (p) => {
    circle(p, 0.5, 0.58, 0.34);
    p.rect(0.42, 0.14, 0.16, 0.1);
  },
  pumpkin: (p) => {
    for (const [x, rx] of [
      [0.3, 0.2],
      [0.7, 0.2],
      [0.5, 0.22],
    ] as const) {
      p.moveTo(x + rx, 0.6);
      p.ellipse(x, 0.6, rx, 0.3, 0, 0, TAU);
      p.closePath();
    }
    p.moveTo(0.48, 0.32);
    p.quadraticCurveTo(0.46, 0.18, 0.56, 0.1);
    p.lineTo(0.6, 0.14);
    p.quadraticCurveTo(0.53, 0.2, 0.54, 0.32);
    p.closePath();
  },
  bat: (p) => {
    p.moveTo(0.5, 0.36);
    p.bezierCurveTo(0.58, 0.3, 0.7, 0.24, 0.95, 0.28);
    p.bezierCurveTo(0.86, 0.36, 0.86, 0.44, 0.9, 0.52);
    p.bezierCurveTo(0.8, 0.48, 0.74, 0.52, 0.7, 0.6);
    p.bezierCurveTo(0.64, 0.54, 0.58, 0.56, 0.5, 0.66);
    p.bezierCurveTo(0.42, 0.56, 0.36, 0.54, 0.3, 0.6);
    p.bezierCurveTo(0.26, 0.52, 0.2, 0.48, 0.1, 0.52);
    p.bezierCurveTo(0.14, 0.44, 0.14, 0.36, 0.05, 0.28);
    p.bezierCurveTo(0.3, 0.24, 0.42, 0.3, 0.5, 0.36);
    p.closePath();
  },
  ghost: (p) => {
    p.moveTo(0.2, 0.9);
    p.lineTo(0.2, 0.42);
    p.bezierCurveTo(0.2, 0.06, 0.8, 0.06, 0.8, 0.42);
    p.lineTo(0.8, 0.9);
    p.lineTo(0.7, 0.82);
    p.lineTo(0.6, 0.9);
    p.lineTo(0.5, 0.82);
    p.lineTo(0.4, 0.9);
    p.lineTo(0.3, 0.82);
    p.closePath();
    // Eyes as holes (even-odd).
    circle(p, 0.4, 0.4, 0.05);
    circle(p, 0.6, 0.4, 0.05);
  },
  moon: (p) => {
    // Outer circle (0.5, 0.5, r 0.42) minus inner circle (0.66, 0.5, r 0.34); they cross at
    // (0.77, 0.5 ± 0.3217): 0.873 rad on the outer circle, 1.241 rad on the inner one.
    p.moveTo(0.77, 0.5 - 0.3217);
    p.arc(0.5, 0.5, 0.42, -0.873, 0.873, true);
    p.arc(0.66, 0.5, 0.34, 1.241, -1.241, false);
    p.closePath();
  },
  rattle: (p) => {
    circle(p, 0.38, 0.38, 0.26);
    p.moveTo(0.54, 0.56);
    p.lineTo(0.84, 0.86);
    p.lineTo(0.8, 0.9);
    p.lineTo(0.5, 0.6);
    p.closePath();
    circle(p, 0.86, 0.88, 0.07);
  },
  bottle: (p) => {
    p.rect(0.42, 0.06, 0.16, 0.08);
    p.rect(0.38, 0.14, 0.24, 0.08);
    p.moveTo(0.38, 0.22);
    p.lineTo(0.62, 0.22);
    p.bezierCurveTo(0.74, 0.3, 0.74, 0.36, 0.74, 0.42);
    p.lineTo(0.74, 0.86);
    p.quadraticCurveTo(0.74, 0.94, 0.66, 0.94);
    p.lineTo(0.34, 0.94);
    p.quadraticCurveTo(0.26, 0.94, 0.26, 0.86);
    p.lineTo(0.26, 0.42);
    p.bezierCurveTo(0.26, 0.36, 0.26, 0.3, 0.38, 0.22);
    p.closePath();
  },
  camera: (p) => {
    p.moveTo(0.08, 0.32);
    p.lineTo(0.3, 0.32);
    p.lineTo(0.36, 0.2);
    p.lineTo(0.64, 0.2);
    p.lineTo(0.7, 0.32);
    p.lineTo(0.92, 0.32);
    p.lineTo(0.92, 0.82);
    p.lineTo(0.08, 0.82);
    p.closePath();
    circle(p, 0.5, 0.56, 0.18);
    circle(p, 0.5, 0.56, 0.11);
  },
  divider: (p) => {
    p.rect(0.02, 0.485, 0.38, 0.03);
    p.rect(0.6, 0.485, 0.38, 0.03);
    p.moveTo(0.5, 0.38);
    p.lineTo(0.58, 0.5);
    p.lineTo(0.5, 0.62);
    p.lineTo(0.42, 0.5);
    p.closePath();
  },
  corner: (p) => {
    // A frame corner flourish for the top-left; rotate the element for the other corners.
    p.moveTo(0.04, 0.04);
    p.lineTo(0.7, 0.04);
    p.lineTo(0.7, 0.08);
    p.lineTo(0.08, 0.08);
    p.lineTo(0.08, 0.7);
    p.lineTo(0.04, 0.7);
    p.closePath();
    p.moveTo(0.16, 0.16);
    p.bezierCurveTo(0.42, 0.14, 0.44, 0.32, 0.3, 0.34);
    p.bezierCurveTo(0.2, 0.36, 0.18, 0.24, 0.26, 0.24);
    p.lineTo(0.27, 0.27);
    p.bezierCurveTo(0.23, 0.28, 0.25, 0.32, 0.3, 0.31);
    p.bezierCurveTo(0.4, 0.29, 0.38, 0.17, 0.16, 0.19);
    p.closePath();
  },
  frame: (p) => {
    p.rect(0.02, 0.02, 0.96, 0.96);
    p.rect(0.06, 0.06, 0.88, 0.88);
  },
  wave: (p) => {
    p.moveTo(0, 0.55);
    for (let i = 0; i < 4; i++) {
      const x = i * 0.25;
      p.bezierCurveTo(x + 0.06, 0.35, x + 0.19, 0.35, x + 0.25, 0.55);
    }
    p.lineTo(1, 0.65);
    for (let i = 3; i >= 0; i--) {
      const x = i * 0.25;
      p.bezierCurveTo(x + 0.19, 0.45, x + 0.06, 0.45, x, 0.65);
    }
    p.closePath();
  },
};

/** Ornaments with holes (rings, a frame, eyes, a lens) are filled even-odd; the rest non-zero. */
export const EVEN_ODD: ReadonlySet<Ornament> = new Set<Ornament>(['rings', 'frame', 'ghost', 'camera']);

/** Draw an ornament filling a w×h box (aspect kept, centred). */
export function ornamentPath(name: Ornament, w: number, h: number): Path2D {
  const s = Math.min(w, h);
  const ox = (w - s) / 2;
  const oy = (h - s) / 2;
  const path = new Path2D();
  const t = (x: number, y: number) => [ox + x * s, oy + y * s] as const;
  const scaled: Path = {
    moveTo: (x, y) => path.moveTo(...t(x, y)),
    lineTo: (x, y) => path.lineTo(...t(x, y)),
    bezierCurveTo: (a, b, c, d, x, y) => path.bezierCurveTo(...t(a, b), ...t(c, d), ...t(x, y)),
    quadraticCurveTo: (a, b, x, y) => path.quadraticCurveTo(...t(a, b), ...t(x, y)),
    arc: (x, y, r, a0, a1, ccw) => path.arc(...t(x, y), r * s, a0, a1, ccw),
    ellipse: (x, y, rx, ry, rot, a0, a1, ccw) => path.ellipse(...t(x, y), rx * s, ry * s, rot, a0, a1, ccw),
    rect: (x, y, ww, hh) => path.rect(...t(x, y), ww * s, hh * s),
    closePath: () => path.closePath(),
  };
  ORNAMENT_PATHS[name](scaled);
  return path;
}
