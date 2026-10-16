import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DesignShowcase } from './DesignShowcase';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('design');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** Internal reference for the ported Immersia Booth design system; reviewed on preview deploys. */
export default function DesignPage() {
  return <DesignShowcase />;
}
