import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Infinity as InfinityIcon, MonitorSmartphone, WifiOff } from 'lucide-react';
import { BrandMark, buttonClass } from '@immersia/ui';
import { LanguagePicker } from '@/components/LanguagePicker';

export default async function HomePage() {
  const t = await getTranslations('home');
  const tc = await getTranslations('common');
  const points = [
    { icon: InfinityIcon, title: t('points.freeTitle'), body: t('points.freeBody') },
    { icon: WifiOff, title: t('points.offlineTitle'), body: t('points.offlineBody') },
    { icon: MonitorSmartphone, title: t('points.anyTitle'), body: t('points.anyBody') },
  ];
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only rounded-lg bg-elev px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        {tc('skipToContent')}
      </a>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-[-0.01em]">
          <BrandMark size={30} />
          {tc('appName')}
        </Link>
        <div className="flex items-center gap-2">
          <LanguagePicker className="w-36" />
          <Link href="/sign-in" className={buttonClass({ variant: 'primary' })}>
            {t('signIn')}
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pt-14 pb-24 sm:px-8 sm:pt-24">
        <div className="eyebrow mb-5">{t('eyebrow')}</div>
        <h1 className="max-w-4xl text-[clamp(2.5rem,7vw,5.5rem)] leading-[0.98] font-bold tracking-[-0.04em]">
          {t('title')}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">{t('lede')}</p>
        <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link href="/sign-in" className={buttonClass({ variant: 'primary', size: 'lg' })}>
            {t('signIn')}
          </Link>
          <Link
            href="/c"
            className="focus-ring rounded text-[15px] font-medium text-accent underline-offset-4 hover:underline"
          >
            {t('enterCode')}
          </Link>
        </div>
        <ul className="mt-20 grid gap-4 sm:grid-cols-3">
          {points.map(({ icon: Icon, title, body }) => (
            <li key={title} className="card p-6">
              <Icon className="size-5 text-accent" aria-hidden />
              <h2 className="mt-4 text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ul>
      </main>
      <footer className="mx-auto flex max-w-6xl gap-x-2 px-4 pb-10 sm:px-8">
        <Link href="/privacy" className="focus-ring rounded px-2 py-2 text-sm font-medium text-muted hover:text-fg">
          {tc('privacy')}
        </Link>
        <Link href="/terms" className="focus-ring rounded px-2 py-2 text-sm font-medium text-muted hover:text-fg">
          {tc('terms')}
        </Link>
      </footer>
    </div>
  );
}
