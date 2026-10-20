import type { ReactNode } from 'react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { BrandMark } from '@immersia/ui';
import { LanguagePicker } from '@/components/LanguagePicker';

/**
 * Shared layout for /privacy and /terms: a plain, fast, server-rendered reading page with no
 * scripts beyond the language picker and no third parties.
 *
 * LEGAL REVIEW REQUIRED BEFORE LAUNCH. The wording of both documents (src/…/messages/*.json, the
 * `legal` namespace) is a good-faith draft written from the product's actual behaviour. It has not
 * been reviewed by a lawyer. Before launch, have counsel confirm at least: the legal entity and
 * address that must be named, governing law and venue (deliberately absent), the controller/processor
 * split, the lawful bases, international-transfer mechanisms, backup retention, the sub-processor
 * list and the NDPA/GDPR representative requirements, and review the Spanish and Portuguese texts.
 */

/** The date shown as "last updated"; bump it whenever the wording changes. */
export const LEGAL_UPDATED = '2026-10-20';

/** A paragraph (string/node) or a bulleted list. */
export type LegalBlock = ReactNode | { list: ReactNode[] };

export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

const isList = (b: LegalBlock): b is { list: ReactNode[] } =>
  typeof b === 'object' && b !== null && !Array.isArray(b) && 'list' in b;

/** Turn a mention of the contact address into a mailto link. */
export function withEmail(text: string, email: string): ReactNode {
  const at = text.indexOf(email);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <a href={`mailto:${email}`} className="focus-ring rounded font-medium text-accent underline underline-offset-4">
        {email}
      </a>
      {text.slice(at + email.length)}
    </>
  );
}

export async function LegalPage({ title, lede, sections }: { title: string; lede: string; sections: LegalSection[] }) {
  const [t, tc, format] = await Promise.all([getTranslations('legal'), getTranslations('common'), getFormatter()]);
  const link = 'focus-ring rounded px-2 py-2 text-sm font-medium text-muted hover:text-fg';
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only rounded-lg bg-elev px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        {tc('skipToContent')}
      </a>
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-[-0.01em]">
          <BrandMark size={30} />
          {tc('appName')}
        </Link>
        <LanguagePicker className="w-36" />
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 pt-8 pb-20 sm:px-8">
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[1.02] font-bold tracking-[-0.03em]">{title}</h1>
        <p className="mt-3 text-sm text-muted">
          {t('updated', { date: format.dateTime(new Date(`${LEGAL_UPDATED}T12:00:00Z`), { dateStyle: 'long' }) })}
        </p>
        <p className="mt-6 text-lg leading-relaxed text-muted">{lede}</p>
        <nav aria-label={title} className="mt-8 rounded-2xl border border-line bg-elev p-5">
          <ol className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="focus-ring inline-flex min-h-8 items-center rounded text-accent hover:underline"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="mt-10 space-y-10">
          {sections.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-6">
              <h2 id={`${s.id}-title`} className="text-xl font-bold tracking-[-0.02em]">
                {s.title}
              </h2>
              <div className="mt-3 space-y-3 text-[15px] leading-relaxed">
                {s.blocks.map((b, i) =>
                  isList(b) ? (
                    <ul key={i} className="list-disc space-y-2 pl-5 marker:text-faint">
                      {b.list.map((item, j) => (
                        <li key={j}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p key={i}>{b}</p>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      </main>
      <footer className="mx-auto flex max-w-3xl flex-wrap gap-x-2 px-4 pb-10 sm:px-8">
        <Link href="/privacy" className={link}>
          {tc('privacy')}
        </Link>
        <Link href="/terms" className={link}>
          {tc('terms')}
        </Link>
      </footer>
    </div>
  );
}
