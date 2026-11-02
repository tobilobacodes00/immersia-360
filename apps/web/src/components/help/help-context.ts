import { getTranslations } from 'next-intl/server';
import { helpHref, type HelpScope } from '@/lib/help-links';
import { HELP_CATEGORIES } from '@/lib/help/frontmatter';
import type { MarkdownContext } from './Markdown';

/** What the Markdown renderer needs on this side of the site (public or inside the Studio). */
export async function markdownContext(scope: HelpScope): Promise<MarkdownContext> {
  const t = await getTranslations('help.markdown');
  return {
    helpHref: (slug, anchor) => helpHref(slug, scope, anchor ?? undefined),
    labels: {
      note: t('note'),
      tip: t('tip'),
      warning: t('warning'),
      code: t('code'),
      table: t('table'),
      newTab: t('newTab'),
    },
  };
}

/** Category id → name in the reader's language. */
export async function categoryNames(): Promise<Record<string, string>> {
  const t = await getTranslations('help.categories');
  return Object.fromEntries(HELP_CATEGORIES.map((c) => [c, t(c)]));
}
