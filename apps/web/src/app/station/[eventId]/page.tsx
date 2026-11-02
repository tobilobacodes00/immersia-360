import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { brandingSchema } from '@immersia/shared';
import { getEvent } from '@/server/events';
import { requireOperator } from '@/server/session';
import { StationClient } from './StationClient';

export const metadata: Metadata = { title: 'Sharing Station', robots: { index: false } };

/** Screen 16 (SHR-4): a second device where guests find their files and scan their QR. */
export default async function StationPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const op = await requireOperator({ event: ['run'] });
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) notFound();
  const event = await getEvent(op.organizationId, eventId);
  if (!event || event.status === 'archived') notFound();
  const branding = brandingSchema.parse(event.branding);
  return (
    <StationClient
      event={{
        id: event.id,
        name: event.name,
        theme: branding.theme,
        hashtag: branding.hashtag,
        kioskPinHash: event.kioskPinHash,
      }}
    />
  );
}
