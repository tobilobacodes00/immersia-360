'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { Pill } from '@immersia/ui';
import { helpHref, type HelpScope } from '@/lib/help-links';
import { search, type IndexedDoc } from '@/lib/help/search';

/**
 * The help centre's search box (HLP-2). The index (title, summary, headings, keywords and the words
 * of every article) is sent with the page, so results appear as the person types and still work if
 * the venue's connection drops afterwards. With nothing typed it shows `children`: the browse view.
 */
export function HelpSearch({
  index,
  scope,
  categoryNames,
  children,
}: {
  index: IndexedDoc[];
  scope: HelpScope;
  /** Category id → its name in the reader's language. */
  categoryNames: Record<string, string>;
  children: ReactNode;
}) {
  const t = useTranslations('help.search');
  const [query, setQuery] = useState('');
  const inputId = useId();
  const text = query.trim();
  const results = useMemo(() => search(index, text), [index, text]);

  return (
    <div>
      <form role="search" aria-label={t('label')} onSubmit={(e) => e.preventDefault()}>
        <label htmlFor={inputId} className="sr-only">
          {t('label')}
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('placeholder')}
            autoComplete="off"
            spellCheck={false}
            className="h-14 w-full rounded-2xl border border-line-strong bg-elev pr-12 pl-12 text-base outline-none transition-colors placeholder:text-faint hover:border-[#c9c6bd] focus:border-accent focus:ring-3 focus:ring-accent-soft"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('clear')}
              className="focus-ring absolute top-1/2 right-3 grid size-9 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-sunken hover:text-fg"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </form>

      {text === '' ? (
        <div className="mt-10">{children}</div>
      ) : (
        <section aria-label={t('resultsLabel')} className="mt-6">
          <p role="status" aria-live="polite" className="text-sm text-muted">
            {t('count', { count: results.length, query: text })}
          </p>
          {results.length === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-muted">{t('none')}</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {results.map(({ doc }) => (
                <li key={doc.slug}>
                  <Link
                    href={helpHref(doc.slug, scope)}
                    className="focus-ring card block px-5 py-4 transition-colors hover:bg-sunken/60"
                  >
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[15px] font-semibold tracking-[-0.01em]">{doc.title}</span>
                      <Pill>{categoryNames[doc.category] ?? doc.category}</Pill>
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted">{doc.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
