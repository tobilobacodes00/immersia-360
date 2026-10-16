/**
 * Locales (NFR Localisation): English, Spanish and Portuguese at launch, French in V1.1. URLs carry
 * no locale prefix — a guest's share link must work in any language — so the locale comes from the
 * `NEXT_LOCALE` cookie (language picker) or Accept-Language.
 */
export const LOCALES = ['en', 'es', 'pt'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  pt: 'Português',
};

export function isLocale(value: string | null | undefined): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? '');
}

/**
 * Best match for an Accept-Language header, honouring q-values. Region tags fall back to their base
 * language (pt-BR → pt, es-419 → es).
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const quality = q ? Number.parseFloat(q.slice(2)) : 1;
      return { base: tag.toLowerCase().split('-')[0] ?? '', quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((x) => x.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { base } of ranked) if (isLocale(base)) return base;
  return DEFAULT_LOCALE;
}
