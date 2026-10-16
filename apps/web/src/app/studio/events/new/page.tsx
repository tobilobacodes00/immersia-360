import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@immersia/ui';
import { requireOperator } from '@/server/session';
import { NewEventForm } from './NewEventForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.newEvent');
  return { title: t('title') };
}

export default async function NewEventPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  await requireOperator({ event: ['create'] });
  const { mode } = await searchParams;
  const t = await getTranslations('studio.newEvent');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <NewEventForm initialMode={mode === 'photo' ? 'photo' : 'video360'} />
    </>
  );
}
