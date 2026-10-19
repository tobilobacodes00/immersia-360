import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { brandingSchema, outputSettingsSchema, shareSettingsSchema, templateAssetIds } from '@immersia/shared';
import { assetViews } from '@/server/assets';
import { getEvent } from '@/server/events';
import { requireOperator } from '@/server/session';
import { getTemplate } from '@/server/templates';

/** Long enough for a slow venue connection to fill the device cache; cached files never expire. */
const ASSET_URL_TTL_S = 12 * 60 * 60;
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
  // The design (screen 6) and every file the media draws, for the booth's offline cache.
  const designId = event.mode === 'photo' ? output.photo.layoutTemplateId : output.video360.overlayTemplateId;
  const design = designId ? await getTemplate(op.organizationId, designId) : null;
  const v = output.video360;
  const ids = [
    ...(design ? templateAssetIds(design.doc) : []),
    ...(event.mode === 'video360' ? [v.introAssetId, v.outroAssetId, v.music?.assetId ?? null] : []),
  ].filter((x): x is string => !!x);
  const assets = await assetViews(op.organizationId, [...new Set(ids)], ASSET_URL_TTL_S);
  const media = {
    branding: {
      hashtag: branding.hashtag,
      custom1: branding.custom1,
      custom2: branding.custom2,
      custom3: branding.custom3,
    },
    assets,
  };
  const common = {
    id: event.id,
    name: event.name,
    theme: branding.theme,
    attract: { headline: branding.attract.headline, cta: branding.attract.cta },
    kioskPinHash: event.kioskPinHash,
    liveDisplay: event.liveDisplayEnabled,
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
          layout: design?.doc ?? null,
          media,
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
        media: { ...media, name: event.name, date: event.date, overlay: design?.doc ?? null },
      }}
    />
  );
}
