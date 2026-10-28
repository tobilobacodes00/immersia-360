'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { TEMPLATE_CATEGORIES, type TemplateCategory } from '@immersia/layout';
import { eventTokens, type TokenContext } from '@immersia/shared';
import { SIZE_KEYS, type SizeKey } from '@/lib/builtin-templates';
import type { TemplateSummary } from '@/server/templates';

/** A believable link and code, so a QR on a preview looks like the real one. */
export const SAMPLE_QR = { url: 'https://immersia.example/s/preview-link-0000000000000000', code: 'K7M2PQ' };

/**
 * Names the library's templates in the reader's language, from parts: the occasion, the style and a
 * description of the page and shots (`studio.templates.*`). Saved templates keep the name they were
 * given. Also the sample event each occasion is previewed with.
 */
export function useTemplateNames() {
  const t = useTranslations('studio.templates');
  return useMemo(() => {
    const sizeLabel = (key: SizeKey) =>
      key === '9:16' || key === '1:1' || key === '16:9' ? t(`aspects.${key}`) : t(`sizes.${key}`);
    /** The page: "4×6 in · 3 photos" for a layout, "Overlay 9:16" for an overlay. */
    const describe = (x: TemplateSummary): string => {
      if (x.kind === 'overlay') return x.aspect ? t(`aspects.${x.aspect}`) : '';
      if (!x.printSize) return '';
      return t('layoutDescription', { size: t(`sizes.${x.printSize}`), count: x.shots ?? 0 });
    };
    /** "Wedding · Blush romance", or null for a template that is not from the library. */
    const occasion = (x: TemplateSummary): string | null =>
      x.builtIn && x.category && x.style ? `${t(`categories.${x.category}`)} · ${t(`styles.${x.style}`)}` : null;
    const name = (x: TemplateSummary): string =>
      x.builtIn && x.category && x.style
        ? t('templateName', {
            category: t(`categories.${x.category}`),
            style: t(`styles.${x.style}`),
            layout: describe(x),
          })
        : x.name;
    const sizeOptions = SIZE_KEYS.map((key) => ({ value: key, label: sizeLabel(key) }));
    const category = (c: TemplateCategory) => t(`categories.${c}`);
    // Each occasion is previewed with its own sample event (an event name in the reader's language).
    const samples = new Map<TemplateCategory, TokenContext>(
      TEMPLATE_CATEGORIES.map((c) => [
        c,
        eventTokens({ name: t(`samples.${c}`), date: '2026-06-14' }, { hashtag: '#immersia' }, null),
      ]),
    );
    const wedding = samples.get('wedding') ?? {};
    const tokens = (c: TemplateCategory | undefined): TokenContext => (c && samples.get(c)) || wedding;
    return { sizeLabel, describe, occasion, name, sizeOptions, category, tokens };
  }, [t]);
}
