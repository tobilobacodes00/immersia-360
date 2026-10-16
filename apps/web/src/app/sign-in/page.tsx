import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BrandMark } from '@immersia/ui';
import { LanguagePicker } from '@/components/LanguagePicker';
import { safeNext } from '@/lib/safe-next';
import { googleEnabled } from '@/server/auth';
import { getSession } from '@/server/session';
import { SignInForm } from './SignInForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('signIn');
  return { title: t('title'), robots: { index: false } };
}

/** Screen 1: magic link, Google, language picker. */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const destination = safeNext(next);
  if (await getSession()) redirect(destination as Route);
  const t = await getTranslations('signIn');
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="grid flex-1 place-items-center px-4 py-12">
        <div className="w-full max-w-sm">
          <BrandMark size={40} className="mb-8" />
          <h1 className="text-[30px] leading-[1.05] font-bold tracking-[-0.03em]">{t('title')}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">{t('subtitle')}</p>
          <SignInForm
            destination={destination}
            google={googleEnabled()}
            initialError={error ? t('errors.generic') : null}
          />
        </div>
      </main>
      <footer className="flex items-center justify-center gap-3 px-4 py-6">
        <LanguagePicker className="w-40" />
      </footer>
    </div>
  );
}
