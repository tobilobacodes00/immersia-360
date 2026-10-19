'use client';

import { useEffect, useRef } from 'react';

const COLORS = ['#2b3fe6', '#f2c14e', '#ef476f', '#06d6a0', '#ffffff', '#111110'];

/**
 * PHO-11: confetti when the strip is revealed. A one-shot canvas burst (about 2.5 s), drawn above the
 * reveal and ignoring pointer events. Skipped entirely for people who ask for reduced motion.
 */
export function Confetti({ accent }: { accent?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = (canvas.width = canvas.clientWidth * dpr);
    const h = (canvas.height = canvas.clientHeight * dpr);
    const colors = accent ? [accent, ...COLORS] : COLORS;
    // Deterministic spread (no Math.random needed for a pleasing burst).
    const pieces = Array.from({ length: 140 }, (_, i) => {
      const a = (i * 137.508 * Math.PI) / 180;
      const speed = (6 + (i % 7)) * dpr;
      return {
        x: w / 2,
        y: h * 0.35,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 9 * dpr,
        size: (6 + (i % 5) * 2) * dpr,
        spin: ((i % 9) - 4) * 0.08,
        angle: a,
        color: colors[i % colors.length]!,
      };
    });
    let frame = 0;
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of pieces) {
        p.vy += 0.35 * dpr;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - frame / 150);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (++frame < 150) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [accent]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-30 size-full" />;
}
