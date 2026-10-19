import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { brandingSchema, outputSettingsSchema, shareSettingsSchema } from '@immersia/shared';
import { getEvent } from '@/server/events';
import { requireOperator } from '@/server/session';
import { BoothClient } from './BoothClient';

export const metadata: Metadata = { title: 'Booth', robots: { index: false } };

/** Screens 10–12: the 360 booth or the photo booth, by the event's mode. */
export default async function BoothPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const op = await requireOperator({ event: ['run'] });
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) notFound();
  const event = await getEvent(op.organizationId, eventId);
  if (!event || event.status === 'archived') notFound();
  const output = outputSettingsSchema.parse(event.outputSettings);
  const branding = brandingSchema.parse(event.branding);
  const share = shareSettingsSchema.parse(event.shareSettings);
  const common = {
    id: event.id,
    name: event.name,
    theme: branding.theme,
    attract: { headline: branding.attract.headline, cta: branding.attract.cta },
    kioskPinHash: event.kioskPinHash,
  };
  if (event.mode === 'photo')
    return (
      <BoothClient
        mode="photo"
        event={{
          ...common,
          date: event.date,
          photo: output.photo,
          triggers: { tap: output.triggers.tap, keyboard: output.triggers.keyboard },
          share: { qr: share.qr, email: share.email, sms: share.sms, whatsapp: share.whatsapp, stripQr: share.stripQr },
        }}
      />
    );
  return (
    <BoothClient
      mode="video360"
      event={{
        ...common,
        video: output.video360,
        triggers: output.triggers,
        share: {
          qr: share.qr,
          email: share.email,
          sms: share.sms,
          whatsapp: share.whatsapp,
          smallerVersion: share.smallerVersion,
        },
      }}
    />
  );
}
