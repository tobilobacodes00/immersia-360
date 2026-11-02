import { describe, expect, it } from 'vitest';
import { rotatedBounds, snapMove, snapPoint } from './snap';

const canvas = { width: 1200, height: 1800 };

describe('snapMove (PHO-4 snap guides)', () => {
  it('snaps a box centre to the canvas centre', () => {
    const r = snapMove({ x: 497, y: 300, width: 200, height: 100 }, [], canvas, 6);
    expect(r.dx).toBe(3); // centre 597 → 600
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ orientation: 'v', at: 600, from: 0, to: 1800 }]);
  });

  it('snaps edges to another box on both axes and spans the guide over both', () => {
    const other = { x: 100, y: 1000, width: 300, height: 200 };
    const r = snapMove({ x: 404, y: 1197, width: 100, height: 100 }, [other], canvas, 6);
    expect(r.dx).toBe(-4); // left 404 → other's right 400
    expect(r.dy).toBe(3); // top 1197 → other's bottom 1200
    const v = r.guides.find((g) => g.orientation === 'v')!;
    expect(v.at).toBe(400);
    expect(v.from).toBe(1000);
    expect(v.to).toBe(1300);
  });

  it('prefers the nearest line and ignores anything beyond the threshold', () => {
    const r = snapMove({ x: 20, y: 20, width: 50, height: 50 }, [{ x: 75, y: 500, width: 10, height: 10 }], canvas, 6);
    expect(r.dx).toBe(5); // right edge 70 → 75 (5 px) beats nothing else within 6
    expect(snapMove({ x: 20, y: 20, width: 50, height: 50 }, [], canvas, 6).guides).toEqual([]);
  });
});

describe('snapPoint', () => {
  it('snaps a resize handle to the nearest edge', () => {
    const r = snapPoint({ x: 1196, y: 903 }, [], canvas, 6);
    expect(r.x).toBe(1200);
    expect(r.y).toBe(900);
    expect(r.guides).toHaveLength(2);
  });
});

describe('rotatedBounds', () => {
  it('is the box itself when unrotated and swaps sides at 90°', () => {
    const b = { x: 0, y: 0, width: 200, height: 100 };
    expect(rotatedBounds(b, 0)).toBe(b);
    const r = rotatedBounds(b, 90);
    expect(r.width).toBeCloseTo(100);
    expect(r.height).toBeCloseTo(200);
    expect(r.x + r.width / 2).toBeCloseTo(100);
    expect(r.y + r.height / 2).toBeCloseTo(50);
  });
});
