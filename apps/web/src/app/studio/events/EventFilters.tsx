'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Segmented, TextInput, Toggle } from '@immersia/ui';

type ModeFilter = 'all' | 'video360' | 'photo';

/** URL-driven filters: the server renders the results; links to a filtered view are shareable. */
export function EventFilters({
  initial,
}: {
  initial: { q?: string; mode?: 'video360' | 'photo'; from?: string; to?: string; archived: boolean };
}) {
  const t = useTranslations('studio.events');
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(initial.q ?? '');
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const update = (patch: Record<string, string | undefined>) => {
    // Read the live URL, not the params captured at render: a debounced search must not undo a
    // filter chosen while it was waiting.
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    // Same page, new query string: always a valid route.
    start(() => router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, { scroll: false }));
  };

  useEffect(() => () => clearTimeout(debounce.current), []);

  const dateInput =
    'h-9 rounded-[10px] border border-line-strong bg-elev px-3 text-sm outline-none transition-colors hover:border-[#c9c6bd] focus:border-accent focus:ring-3 focus:ring-accent-soft';

  return (
    <div className="flex flex-wrap items-center gap-3" aria-busy={pending}>
      <div className="relative min-w-[220px] flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <TextInput
          value={q}
          ariaLabel={t('search')}
          placeholder={t('search')}
          className="pl-9"
          onChange={(v) => {
            setQ(v);
            clearTimeout(debounce.current);
            debounce.current = setTimeout(() => update({ q: v.trim() || undefined }), 300);
          }}
        />
      </div>
      <Segmented<ModeFilter>
        label={t('filterMode')}
        value={initial.mode ?? 'all'}
        onChange={(m) => update({ mode: m === 'all' ? undefined : m })}
        options={[
          { value: 'all', label: t('modes.all') },
          { value: 'video360', label: t('modes.video360') },
          { value: 'photo', label: t('modes.photo') },
        ]}
      />
      <label className="flex items-center gap-2 text-[13px] text-muted">
        {t('from')}
        <input
          type="date"
          className={dateInput}
          defaultValue={initial.from}
          onChange={(e) => update({ from: e.target.value || undefined })}
        />
      </label>
      <label className="flex items-center gap-2 text-[13px] text-muted">
        {t('to')}
        <input
          type="date"
          className={dateInput}
          defaultValue={initial.to}
          onChange={(e) => update({ to: e.target.value || undefined })}
        />
      </label>
      <label className="flex items-center gap-2 text-[13px] text-muted">
        <Toggle
          checked={initial.archived}
          onChange={(v) => update({ archived: v ? '1' : undefined })}
          label={t('showArchived')}
        />
        {t('showArchived')}
      </label>
    </div>
  );
}
