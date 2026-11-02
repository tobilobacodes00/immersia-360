import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { HelpHome } from '@/components/help/HelpHome';
import { PublicShell } from '@/components/PublicShell';
import { getOperator } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('help');
  return { title: t('metaTitle'), description: t('subtitle') };
}

/** Screen 22 for everyone (HLP-2): the same help centre as the Studio's, for readers who aren't signed in. */
export default async function PublicHelpPage() {
  // Only to prefill the contact form; the help centre must not depend on the database being up.
  const operator = await getOperator().catch(() => null);
  return (
    <PublicShell>
      <HelpHome scope="public" operator={operator && { name: operator.name, email: operator.email }} />
    </PublicShell>
  );
}
