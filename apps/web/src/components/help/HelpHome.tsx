import Link from 'next/link';
import type { Route } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Activity, PlayCircle } from 'lucide-react';
import type { Locale } from '@immersia/i18n';
import { PageHeader, Pill, buttonClass } from '@immersia/ui';
import { helpHref, type HelpScope } from '@/lib/help-links';
import { HELP_CATEGORIES } from '@/lib/help/frontmatter';
import { SUPPORT_RESPONSE_BUSINESS_DAYS } from '@/lib/support';
import { supportEmail } from '@/server/env';
import { helpLibrary } from '@/server/help';
import { ContactForm } from './ContactForm';
import { HelpSearch } from './HelpSearch';
import { Markdown } from './Markdown';
import { categoryNames, markdownContext } from './help-context';

/**
 * Screen 22, "Help centre" (HLP-2): search, the guides by topic, the FAQ, video tutorials, a way to
 * contact us and a link to the status page. One page for both homes of the help centre: public
 * (/help, for anyone, signed in or not) and inside the Studio (/studio/help).
 */
export async function HelpHome({
  scope,
  operator,
}: {
  scope: HelpScope;
  /** The signed-in operator, to prefill the contact form. */
  operator: { name: string; email: string } | null;
}) {
  const locale = (await getLocale()) as Locale;
  const [t, library, names, ctx] = await Promise.all([
    getTranslations('help'),
    helpLibrary(locale),
    categoryNames(),
    markdownContext(scope),
  ]);
  const guides = library.articles.filter((a) => a.meta.category !== 'faq');
  const faq = library.articles.filter((a) => a.meta.category === 'faq');
  const videos = library.articles.filter((a) => a.meta.video);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <HelpSearch index={library.index} scope={scope} categoryNames={names}>
        <div className="space-y-14">
          <section aria-labelledby="help-browse">
            <h2 id="help-browse" className="text-[22px] font-bold tracking-[-0.02em]">
              {t('browse.title')}
            </h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {HELP_CATEGORIES.filter((c) => c !== 'faq').map((category) => {
                const items = guides.filter((a) => a.meta.category === category);
                if (items.length === 0) return null;
                return (
                  <section key={category} aria-labelledby={`help-cat-${category}`} className="card px-5 py-5 sm:px-6">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 id={`help-cat-${category}`} className="text-[15px] font-semibold tracking-[-0.01em]">
                        {names[category]}
                      </h3>
                      <span className="text-xs text-faint">{t('browse.articles', { count: items.length })}</span>
                    </div>
                    <ul className="mt-3 space-y-1">
                      {items.map((a) => (
                        <li key={a.slug}>
                          <Link
                            href={helpHref(a.slug, scope)}
                            className="focus-ring -mx-2 block rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-sunken hover:text-fg"
                          >
                            {a.meta.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </section>

          {faq.length > 0 && (
            <section id="faq" aria-labelledby="help-faq" className="scroll-mt-24">
              <h2 id="help-faq" className="text-[22px] font-bold tracking-[-0.02em]">
                {t('faq.title')}
              </h2>
              <p className="mt-1.5 text-sm text-muted">{t('faq.subtitle')}</p>
              <div className="mt-5 space-y-2.5">
                {faq.map((a) => (
                  <details key={a.slug} className="card group px-5 py-1 sm:px-6">
                    <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-3.5 text-[15px] font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
                      {a.meta.title}
                      <span
                        aria-hidden
                        className="text-lg leading-none text-faint transition-transform group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <div className="pb-4">
                      <Markdown blocks={a.blocks} ctx={ctx} />
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}

          <section id="videos" aria-labelledby="help-videos" className="scroll-mt-24">
            <h2 id="help-videos" className="text-[22px] font-bold tracking-[-0.02em]">
              {t('videos.title')}
            </h2>
            {videos.length === 0 ? (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{t('videos.empty')}</p>
            ) : (
              <ul className="mt-5 grid gap-4 md:grid-cols-2">
                {videos.map((a) => (
                  <li key={a.slug}>
                    <Link
                      href={helpHref(a.slug, scope)}
                      className="focus-ring card flex h-full items-start gap-3 px-5 py-4 hover:bg-sunken/60"
                    >
                      <PlayCircle className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold">
                          {t('videos.watch', { title: a.meta.title })}
                        </span>
                        <span className="mt-1 block text-sm text-muted">{a.meta.summary}</span>
                        <Pill className="mt-2">{t('videos.captions')}</Pill>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </HelpSearch>

      <section id="contact" aria-labelledby="help-contact" className="mt-14 scroll-mt-24">
        <div className="card px-5 py-6 sm:px-8 sm:py-8">
          <h2 id="help-contact" className="text-[22px] font-bold tracking-[-0.02em]">
            {t('contact.title')}
          </h2>
          <p className="mt-1.5 mb-6 max-w-2xl text-sm leading-relaxed text-muted">
            {t('contact.subtitle', { days: SUPPORT_RESPONSE_BUSINESS_DAYS })}
          </p>
          <ContactForm
            defaults={{ name: operator?.name ?? '', email: operator?.email ?? '' }}
            supportAddress={supportEmail()}
          />
        </div>
      </section>

      <section aria-labelledby="help-status" className="mt-6">
        <div className="card flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div className="flex min-w-0 items-start gap-3">
            <Activity className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <div>
              <h2 id="help-status" className="text-[15px] font-semibold">
                {t('statusLink.title')}
              </h2>
              <p className="mt-0.5 text-sm text-muted">{t('statusLink.body')}</p>
            </div>
          </div>
          <Link href={'/status' as Route} className={buttonClass()}>
            {t('statusLink.open')}
          </Link>
        </div>
      </section>
    </>
  );
}
