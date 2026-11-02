import type { ReactNode } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BrandMark, buttonClass } from '@immersia/ui';
import { LanguagePicker } from '@/components/LanguagePicker';

/**
 * The frame for pages anyone can read (the public help centre, the status page): brand, the two
 * public destinations, language, and a way in. It reads no session and touches no database, so the
 * status page still renders when those are the things that are down.
 */
export async function PublicShell({ children }: { children: ReactNode }) {
  const [t, tc] = await Promise.all([getTranslations('help.shell'), getTranslations('common')]);
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only rounded-lg bg-elev px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        {tc('skipToContent')}
      </a>
      <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-5 sm:px-8">
        <Link
          href="/"
          aria-label={t('home')}
          className="focus-ring flex items-center gap-2.5 rounded-lg font-semibold tracking-[-0.01em]"
        >
          <BrandMark size={30} />
          {tc('appName')}
        </Link>
        <nav aria-label={t('nav')} className="flex flex-wrap items-center gap-1 sm:gap-2">
          <Link href="/help" className="focus-ring rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-fg">
            {t('help')}
          </Link>
          <Link href="/status" className="focus-ring rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-fg">
            {t('status')}
          </Link>
          <LanguagePicker className="w-36" />
          <Link href="/sign-in" className={buttonClass({ variant: 'primary' })}>
            {t('signIn')}
          </Link>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 pt-6 pb-24 sm:px-8 sm:pt-10">
        {children}
      </main>
    </div>
  );
}
