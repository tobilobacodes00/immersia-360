import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { brandingSchema, galleryUrl } from '@immersia/shared';
import { assetViews } from '@/server/assets';
import { appOrigin } from '@/server/env';
import { getEvent } from '@/server/events';
import { requireOperator } from '@/server/session';
import { SignageStudio } from './SignageStudio';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.signage');
  return { title: t('title') };
}

/** Screen 25: event QR signage (DL-5): A4 poster, A5 flyer or table tent, as PNG or PDF. */
export default async function SignagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const op = await requireOperator({ event: ['read'] });
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await getEvent(op.organizationId, id);
  if (!event) notFound();
  const branding = brandingSchema.parse(event.branding);
  // A logo that has since been deleted is simply left off.
  const [logo] = branding.logoAssetId ? await assetViews(op.organizationId, [branding.logoAssetId]) : [];
  return (
    <SignageStudio
      eventName={event.name}
      theme={branding.theme}
      hashtag={branding.hashtag}
      logo={logo ?? null}
      link={galleryUrl(appOrigin(), event.gallerySlug, 'event_qr')}
    />
  );
}
