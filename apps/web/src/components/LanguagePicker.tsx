'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { LOCALES, LOCALE_NAMES, type Locale } from '@immersia/i18n';
import { Select } from '@immersia/ui';
import { setLocale } from '@/i18n/actions';

export function LanguagePicker({ className }: { className?: string }) {
  const t = useTranslations('common');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select<Locale>
      className={className}
      disabled={pending}
      label={t('language')}
      value={locale}
      options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
      onChange={(next) =>
        start(async () => {
          await setLocale(next);
          router.refresh();
        })
      }
    />
  );
}
