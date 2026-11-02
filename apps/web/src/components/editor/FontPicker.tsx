'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Search } from 'lucide-react';
import { FONT_CATEGORIES, FONT_LIBRARY, fontStack, loadLibraryFamily } from '@immersia/fonts';
import { assetFontFamily } from '@immersia/shared';
import { Modal, Segmented, cx } from '@immersia/ui';
import type { AssetView } from '@/server/assets';

/** Fonts every template can use without the library: the app's own (PHO-9 built-ins). */
export const BUILT_IN_FONTS = [
  { family: 'Satoshi', weights: [300, 400, 500, 700, 900], css: 'var(--font-satoshi), system-ui, sans-serif' },
  { family: 'Instrument Serif', weights: [400], css: 'var(--font-instrument-serif), Georgia, serif' },
] as const;

/** The weights a family offers (library, built-in, or an uploaded font's single face). */
export function weightsOf(family: string): number[] {
  const builtIn = BUILT_IN_FONTS.find((f) => f.family === family);
  if (builtIn) return [...builtIn.weights];
  return FONT_LIBRARY.find((f) => f.family === family)?.weights ?? [400];
}

type Category = (typeof FONT_CATEGORIES)[number] | 'all' | 'uploaded';

interface Row {
  family: string;
  label: string;
  css: string;
  library: boolean;
}

/** One font row, loading its face only once it scrolls into view (100+ families). */
function FontRow({ row, selected, onPick }: { row: Row; selected: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !row.library) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        void loadLibraryFamily(row.family, { weights: [400] }).catch(() => undefined);
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [row.family, row.library]);
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={cx(
        'focus-ring flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors',
        selected ? 'bg-accent-soft text-fg' : 'hover:bg-sunken',
      )}
    >
      <span className="min-w-0 truncate text-[22px] leading-tight" style={{ fontFamily: row.css }}>
        {row.label}
      </span>
      {selected && <Check className="size-4 shrink-0 text-accent" aria-hidden />}
    </button>
  );
}

export function FontPicker({
  value,
  onChange,
  uploaded,
}: {
  value: string;
  onChange: (family: string) => void;
  /** The organisation's uploaded fonts (asset type `font`). */
  uploaded: AssetView[];
}) {
  const t = useTranslations('studio.editor.fonts');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<Category>('all');

  const rows = useMemo<Row[]>(() => {
    const builtIn: Row[] = BUILT_IN_FONTS.map((f) => ({
      family: f.family,
      label: f.family,
      css: f.css,
      library: false,
    }));
    const mine: Row[] = uploaded.map((a) => ({
      family: assetFontFamily(a.id),
      label: a.name,
      // The editor registers uploaded faces under this name (lib/template-fonts.ts).
      css: `"imm-font-${a.id}", sans-serif`,
      library: false,
    }));
    const lib: Row[] = FONT_LIBRARY.filter((f) => category === 'all' || f.category === category).map((f) => ({
      family: f.family,
      label: f.family,
      css: fontStack(f.family),
      library: true,
    }));
    const all = category === 'uploaded' ? mine : category === 'all' ? [...builtIn, ...mine, ...lib] : lib;
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((r) => r.label.toLowerCase().includes(needle)) : all;
  }, [uploaded, category, q]);

  const current =
    BUILT_IN_FONTS.find((f) => f.family === value)?.family ??
    uploaded.find((a) => assetFontFamily(a.id) === value)?.name ??
    value;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring flex h-9 w-full items-center justify-between gap-2 rounded-[10px] border border-line-strong bg-elev px-3 text-left text-[13px] transition-colors hover:border-fg/30"
        aria-haspopup="dialog"
      >
        <span className="truncate">{current}</span>
        <span className="text-faint">{t('change')}</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('title')} width="max-w-xl">
        <div className="space-y-3">
          <label className="flex h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-elev px-3 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft">
            <Search className="size-4 text-faint" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>
          <Segmented
            size="sm"
            value={category}
            onChange={setCategory}
            label={t('category')}
            options={[
              { value: 'all', label: t('categories.all') },
              ...FONT_CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) })),
              ...(uploaded.length ? [{ value: 'uploaded' as const, label: t('categories.uploaded') }] : []),
            ]}
          />
          <div role="listbox" aria-label={t('title')} className="-mx-1 max-h-[55vh] overflow-y-auto px-1">
            {rows.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">{t('none')}</p>
            ) : (
              rows.map((r) => (
                <FontRow
                  key={r.family}
                  row={r}
                  selected={r.family === value}
                  onPick={() => {
                    onChange(r.family);
                    setOpen(false);
                  }}
                />
              ))
            )}
          </div>
          <p className="text-[12px] text-faint">{t('licence', { count: FONT_LIBRARY.length })}</p>
        </div>
      </Modal>
    </>
  );
}
