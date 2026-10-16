import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, isLocale, negotiateLocale, type Locale } from '@immersia/i18n';

/**
 * Locale without URL prefixes: guest links must open in the guest's language whatever language the
 * operator uses. Precedence: explicit choice (cookie) → Accept-Language → English.
 */
export async function resolveLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return negotiateLocale((await headers()).get('accept-language'));
}

// Explicit loaders (not a template-literal import) so the bundler sees exactly three chunks.
const MESSAGES: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('@immersia/i18n/messages/en'),
  es: () => import('@immersia/i18n/messages/es'),
  pt: () => import('@immersia/i18n/messages/pt'),
};

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return { locale, messages: (await MESSAGES[locale]()).default };
});
