import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { brandingSchema, outputSettingsSchema } from '@immersia/shared';
import { getEvent } from '@/server/events';
import { requireOperator } from '@/server/session';
import { BoothClient } from './BoothClient';

export const metadata: Metadata = { title: 'Booth', robots: { index: false } };

/** Screen 10: 360 capture. Photo booth capture (screen 11) joins this route in M5. */
export default async function BoothPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const op = await requireOperator({ event: ['run'] });
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) notFound();
  const event = await getEvent(op.organizationId, eventId);
  if (!event || event.status === 'archived' || event.mode !== 'video360') notFound();
  const output = outputSettingsSchema.parse(event.outputSettings);
  const branding = brandingSchema.parse(event.branding);
  return (
    <BoothClient
      event={{
        id: event.id,
        name: event.name,
        video: output.video360,
        triggers: output.triggers,
        theme: branding.theme,
        attract: { headline: branding.attract.headline, cta: branding.attract.cta },
      }}
    />
  );
}
