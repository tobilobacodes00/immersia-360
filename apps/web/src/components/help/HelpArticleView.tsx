import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ChevronRight } from 'lucide-react';
import type { Locale } from '@immersia/i18n';
import { PageHeader, buttonClass } from '@immersia/ui';
import { formatEventDate } from '@/lib/format';
import { HELP_BASE, helpHref, type HelpScope } from '@/lib/help-links';
import { headings } from '@/lib/help/markdown';
import { SUPPORT_RESPONSE_BUSINESS_DAYS } from '@/lib/support';
import { helpArticle, helpLibrary } from '@/server/help';
import { HelpVideo } from './HelpVideo';
import { Markdown } from './Markdown';
import { categoryNames, markdownContext } from './help-context';

/** One help article (HLP-2), for either home of the help centre. */
export async function HelpArticleView({ scope, slug }: { scope: HelpScope; slug: string }) {
  const locale = (await getLocale()) as Locale;
  const article = await helpArticle(locale, slug);
  if (!article) notFound();
  const [t, library, names, ctx] = await Promise.all([
    getTranslations('help'),
    helpLibrary(locale),
    categoryNames(),
    markdownContext(scope),
  ]);
  const { meta } = article;
  const toc = headings(article.blocks).filter((h) => h.level === 2);
  const related = meta.related.flatMap((s) => library.bySlug.get(s) ?? []);
  const base = HELP_BASE[scope] as Route;

  return (
    <article>
      <nav aria-label={t('article.breadcrumb')} className="mb-5">
        <ol className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
          <li>
            <Link href={base} className="focus-ring rounded font-medium hover:text-fg">
              {t('article.back')}
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="size-3.5" />
          </li>
          <li>{names[meta.category]}</li>
        </ol>
      </nav>
      <PageHeader title={meta.title} subtitle={meta.summary} />

      <div className="max-w-3xl">
        {meta.video && meta.captions && (
          <HelpVideo title={meta.title} src={meta.video} captions={meta.captions} locale={locale} />
        )}

        {toc.length >= 3 && (
          <nav aria-label={t('article.onThisPage')} className="card mb-8 px-5 py-4">
            <p className="eyebrow mb-2">{t('article.onThisPage')}</p>
            <ol className="space-y-1 text-sm">
              {toc.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} className="focus-ring rounded text-muted hover:text-fg hover:underline">
                    {h.text}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <Markdown blocks={article.blocks} ctx={ctx} />

        {related.length > 0 && (
          <section aria-labelledby="help-related" className="mt-12">
            <h2 id="help-related" className="text-[17px] font-semibold tracking-[-0.01em]">
              {t('article.related')}
            </h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={helpHref(r.slug, scope)}
                    className="focus-ring card block h-full px-4 py-3 hover:bg-sunken/60"
                  >
                    <span className="block text-sm font-semibold">{r.meta.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{r.meta.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <aside className="card mt-12 flex flex-wrap items-center justify-between gap-4 px-5 py-5">
          <div>
            <p className="text-[15px] font-semibold">{t('article.stillStuck')}</p>
            <p className="mt-0.5 text-sm text-muted">
              {t('article.stillStuckBody', { days: SUPPORT_RESPONSE_BUSINESS_DAYS })}
            </p>
          </div>
          <Link href={`${base}#contact` as Route} className={buttonClass()}>
            {t('article.contact')}
          </Link>
        </aside>

        <p className="mt-6 text-[13px] text-faint">
          {t('article.updated', { date: formatEventDate(meta.updated, locale) })}
        </p>
      </div>
    </article>
  );
}
