import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DisplayClient } from './DisplayClient';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tv.display');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Screen 17: a paired TV's Live Display (LIV-2..5, 9, 10, 12, 13). */
export default function LiveDisplayPage() {
  return <DisplayClient />;
}
