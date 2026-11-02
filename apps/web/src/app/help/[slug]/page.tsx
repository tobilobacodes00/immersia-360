import type { Metadata } from 'next';
import { getLocale } from 'next-intl/server';
import type { Locale } from '@immersia/i18n';
import { HelpArticleView } from '@/components/help/HelpArticleView';
import { PublicShell } from '@/components/PublicShell';
import { helpArticle } from '@/server/help';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const [{ slug }, locale] = await Promise.all([params, getLocale()]);
  const article = await helpArticle(locale as Locale, slug);
  return article ? { title: article.meta.title, description: article.meta.summary } : {};
}

/** A help article, public (HLP-2). */
export default async function PublicHelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <PublicShell>
      <HelpArticleView scope="public" slug={slug} />
    </PublicShell>
  );
}
