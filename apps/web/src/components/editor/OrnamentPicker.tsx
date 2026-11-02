'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { EVEN_ODD, ornamentPath, type Ornament } from '@immersia/layout';
import { ORNAMENTS } from '@immersia/shared';
import { Modal, cx } from '@immersia/ui';

/** An ornament drawn by the same path code the renderer uses. */
export function OrnamentSwatch({
  name,
  size = 40,
  color = '#111110',
}: {
  name: Ornament;
  size?: number;
  color?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = color;
    ctx.fill(ornamentPath(name, size, size), EVEN_ODD.has(name) ? 'evenodd' : 'nonzero');
  }, [name, size, color]);
  return <canvas ref={ref} aria-hidden style={{ width: size, height: size }} />;
}

/** The decoration library (PHO-4 editor, PHO-5 templates). */
export function OrnamentPicker({
  open,
  onClose,
  onPick,
  selected,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (name: Ornament) => void;
  selected?: Ornament;
}) {
  const t = useTranslations('studio.editor.ornaments');
  return (
    <Modal open={open} onClose={onClose} title={t('title')} width="max-w-xl">
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {ORNAMENTS.map((name) => (
          <li key={name}>
            <button
              type="button"
              onClick={() => onPick(name)}
              aria-pressed={selected === name}
              className={cx(
                'focus-ring flex w-full flex-col items-center gap-1 rounded-xl border p-2 text-[11px] transition-colors',
                selected === name ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong',
              )}
            >
              <OrnamentSwatch name={name} />
              <span className="w-full truncate text-center text-muted">{t(`names.${name}`)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
