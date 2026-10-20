import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { HelpHome } from '@/components/help/HelpHome';
import { requireOperator } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('help');
  return { title: t('metaTitle') };
}

/** Screen 22, "Help centre" (HLP-2), inside the Studio. */
export default async function StudioHelpPage() {
  const op = await requireOperator();
  return <HelpHome scope="studio" operator={{ name: op.name, email: op.email }} />;
}
