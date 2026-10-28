'use client';

import type { ReactNode } from 'react';
import { ColorField, Slider } from '@immersia/ui';

/** Compact label/control row for the editor's side panels. */
export function Row({ label, children, htmlFor }: { label: ReactNode; children: ReactNode; htmlFor?: string }) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 py-1">
      <Label {...(htmlFor ? { htmlFor } : {})} className="min-w-0 truncate text-[13px] text-muted">
        {label}
      </Label>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

export function Section({ title, children, action }: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** `#rrggbb` + alpha (`#rrggbbaa`), as the template schema stores colours. */
export function splitAlpha(hex: string): { rgb: string; alpha: number } {
  const v = hex.toLowerCase();
  if (/^#[0-9a-f]{8}$/.test(v)) return { rgb: v.slice(0, 7), alpha: parseInt(v.slice(7), 16) / 255 };
  return { rgb: /^#[0-9a-f]{6}$/.test(v) ? v : '#000000', alpha: 1 };
}

export function joinAlpha(rgb: string, alpha: number): string {
  if (alpha >= 1) return rgb;
  return `${rgb}${Math.round(Math.max(0, alpha) * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/** A colour with transparency: the kit's colour field plus an opacity slider. */
export function AlphaColorField({
  value,
  onChange,
  label,
  alphaLabel,
}: {
  value: string;
  onChange: (v: string, gesture?: boolean) => void;
  label: string;
  alphaLabel: string;
}) {
  const { rgb, alpha } = splitAlpha(value);
  return (
    <div className="space-y-1.5">
      <ColorField
        value={rgb}
        label={label}
        onChange={(v) => /^#[0-9a-fA-F]{6}$/.test(v) && onChange(joinAlpha(v.toLowerCase(), alpha))}
      />
      <Slider
        value={Math.round(alpha * 100)}
        min={0}
        max={100}
        unit="%"
        width="w-44"
        label={alphaLabel}
        onChange={(a) => onChange(joinAlpha(rgb, a / 100), true)}
      />
    </div>
  );
}
