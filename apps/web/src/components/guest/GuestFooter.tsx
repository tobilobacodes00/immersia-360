import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/** Legal links on every guest page. Plain server markup: no JavaScript, no third parties. */
export async function GuestFooter() {
  const t = await getTranslations('common');
  const link = 'focus-ring inline-flex min-h-11 items-center px-2 font-medium underline underline-offset-4';
  return (
    <footer className="mt-12 flex flex-wrap gap-x-4 text-sm">
      <Link href="/privacy" className={link}>
        {t('privacy')}
      </Link>
      <Link href="/terms" className={link}>
        {t('terms')}
      </Link>
    </footer>
  );
}
