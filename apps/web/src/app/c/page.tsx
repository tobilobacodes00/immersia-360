import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BrandMark, buttonClass } from '@immersia/ui';
import { LanguagePicker } from '@/components/LanguagePicker';
import { findCode } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('code');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

const ERRORS = ['invalid', 'not_found', 'expired', 'too_many'] as const;
type CodeErrorKey = (typeof ERRORS)[number];

/**
 * Screen 26: short-code entry (DL-2). A plain form posting to a server action, so it works without
 * any client JavaScript; errors come back in the URL.
 */
export default async function CodePage({ searchParams }: { searchParams: Promise<{ e?: string; code?: string }> }) {
  const { e, code } = await searchParams;
  const t = await getTranslations('code');
  const error = ERRORS.includes(e as CodeErrorKey) ? (e as CodeErrorKey) : null;
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="grid flex-1 place-items-center px-4 py-12">
        <div className="w-full max-w-sm">
          <BrandMark size={40} className="mb-8" />
          <h1 className="text-[30px] leading-[1.05] font-bold tracking-[-0.03em]">{t('title')}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">{t('body')}</p>
          <form action={findCode} className="mt-8" noValidate>
            <label htmlFor="code" className="text-sm font-medium">
              {t('label')}
            </label>
            <input
              id="code"
              name="code"
              defaultValue={code ?? ''}
              placeholder={t('placeholder')}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              maxLength={9}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'code-error' : undefined}
              className="focus-ring mt-2 block h-14 w-full rounded-xl border border-line-strong bg-elev px-4 text-center font-mono text-2xl font-bold tracking-[0.2em] uppercase placeholder:text-faint"
            />
            {error && (
              <p id="code-error" role="alert" className="mt-2 text-sm text-bad">
                {t(`errors.${error}`)}
              </p>
            )}
            <button type="submit" className={buttonClass({ variant: 'primary', size: 'lg', className: 'mt-5 w-full' })}>
              {t('submit')}
            </button>
          </form>
        </div>
      </main>
      <footer className="flex items-center justify-center gap-3 px-4 py-6">
        <LanguagePicker className="w-40" />
      </footer>
    </div>
  );
}
