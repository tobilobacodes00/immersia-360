/**
 * Snap guides (PHO-4). Pure geometry in canvas pixels: the editor converts its screen threshold into
 * canvas units before calling, so snapping feels the same at every zoom.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Guide {
  /** `v`: a vertical line at x = `at`; `h`: a horizontal line at y = `at`. */
  orientation: 'v' | 'h';
  at: number;
  from: number;
  to: number;
}

interface Line {
  at: number;
  /** The extent of whatever produced the line, so the drawn guide spans both boxes. */
  from: number;
  to: number;
}

/** The axis-aligned bounds of a box rotated about its centre. */
export function rotatedBounds(b: Box, rotationDeg: number): Box {
  if (!rotationDeg) return b;
  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const w = b.width * c + b.height * s;
  const h = b.width * s + b.height * c;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/** Lines other things offer: the canvas edges and centre, and every other box's edges and centre. */
export function snapLines(others: Box[], canvas: { width: number; height: number }) {
  const v: Line[] = [
    { at: 0, from: 0, to: canvas.height },
    { at: canvas.width / 2, from: 0, to: canvas.height },
    { at: canvas.width, from: 0, to: canvas.height },
  ];
  const h: Line[] = [
    { at: 0, from: 0, to: canvas.width },
    { at: canvas.height / 2, from: 0, to: canvas.width },
    { at: canvas.height, from: 0, to: canvas.width },
  ];
  for (const o of others) {
    for (const at of [o.x, o.x + o.width / 2, o.x + o.width]) v.push({ at, from: o.y, to: o.y + o.height });
    for (const at of [o.y, o.y + o.height / 2, o.y + o.height]) h.push({ at, from: o.x, to: o.x + o.width });
  }
  return { v, h };
}

/** Best snap on one axis: the smallest move (within `threshold`) that puts one of `edges` on a line. */
function bestSnap(edges: number[], lines: Line[], threshold: number) {
  let best: { delta: number; at: number; lines: Line[] } | null = null;
  for (const e of edges)
    for (const l of lines) {
      const delta = l.at - e;
      if (Math.abs(delta) > threshold) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-6) best = { delta, at: l.at, lines: [l] };
      else if (Math.abs(delta - best.delta) < 1e-6 && l.at === best.at) best.lines.push(l);
    }
  return best;
}

/**
 * Snap a moving box: returns the offset to apply and the guides to draw. Each axis snaps
 * independently, so a box can sit on a vertical and a horizontal guide at once.
 */
export function snapMove(
  moving: Box,
  others: Box[],
  canvas: { width: number; height: number },
  threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
  const { v, h } = snapLines(others, canvas);
  const sx = bestSnap([moving.x, moving.x + moving.width / 2, moving.x + moving.width], v, threshold);
  const sy = bestSnap([moving.y, moving.y + moving.height / 2, moving.y + moving.height], h, threshold);
  const dx = sx?.delta ?? 0;
  const dy = sy?.delta ?? 0;
  const guides: Guide[] = [];
  if (sx) {
    const from = Math.min(moving.y + dy, ...sx.lines.map((l) => l.from));
    const to = Math.max(moving.y + dy + moving.height, ...sx.lines.map((l) => l.to));
    guides.push({ orientation: 'v', at: sx.at, from, to });
  }
  if (sy) {
    const from = Math.min(moving.x + dx, ...sy.lines.map((l) => l.from));
    const to = Math.max(moving.x + dx + moving.width, ...sy.lines.map((l) => l.to));
    guides.push({ orientation: 'h', at: sy.at, from, to });
  }
  return { dx, dy, guides };
}

/** Snap one point (a resize handle) to the nearest lines on each axis. */
export function snapPoint(
  p: { x: number; y: number },
  others: Box[],
  canvas: { width: number; height: number },
  threshold: number,
): { x: number; y: number; guides: Guide[] } {
  const { v, h } = snapLines(others, canvas);
  const sx = bestSnap([p.x], v, threshold);
  const sy = bestSnap([p.y], h, threshold);
  const x = p.x + (sx?.delta ?? 0);
  const y = p.y + (sy?.delta ?? 0);
  const guides: Guide[] = [];
  if (sx)
    guides.push({
      orientation: 'v',
      at: sx.at,
      from: Math.min(y, ...sx.lines.map((l) => l.from)),
      to: Math.max(y, ...sx.lines.map((l) => l.to)),
    });
  if (sy)
    guides.push({
      orientation: 'h',
      at: sy.at,
      from: Math.min(x, ...sy.lines.map((l) => l.from)),
      to: Math.max(x, ...sy.lines.map((l) => l.to)),
    });
  return { x, y, guides };
}
