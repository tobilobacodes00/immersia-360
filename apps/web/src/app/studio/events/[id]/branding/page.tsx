import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  brandingSchema,
  eventBooths,
  outputSettingsSchema,
  shareSettingsSchema,
  templateAssetIds,
} from '@immersia/shared';
import { roleCan } from '@/lib/permissions';
import { assetViews, listAssets } from '@/server/assets';
import { getEvent } from '@/server/events';
import { requireOperator } from '@/server/session';
import { getTemplate, listLibraryTemplates } from '@/server/templates';
import { BrandingEditor } from './BrandingEditor';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.branding');
  return { title: t('title') };
}

/** Screen 5: branding (theme, logo, attract, dynamic fields) and the event's media and design. */
export default async function BrandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const op = await requireOperator({ event: ['read'] });
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await getEvent(op.organizationId, id);
  if (!event) notFound();
  const readOnly = !roleCan(op.role, { event: ['update'] }) || event.status === 'archived';
  const output = outputSettingsSchema.parse(event.outputSettings);
  const branding = brandingSchema.parse(event.branding);
  const share = shareSettingsSchema.parse(event.shareSettings);
  // One design per booth the event runs: a print layout for photo booths, an overlay for 360 booths.
  const booths = eventBooths(event.mode, output);
  const designs = await Promise.all(
    booths.map(async (booth) => {
      const kind = booth === 'photo' ? ('layout' as const) : ('overlay' as const);
      const designId = kind === 'layout' ? output.photo.layoutTemplateId : output.video360.overlayTemplateId;
      const [design, library, uploads] = await Promise.all([
        designId ? getTemplate(op.organizationId, designId) : null,
        // The built-in library is browsed on its own screen: the chooser lists the organisation's saved designs.
        listLibraryTemplates(op.organizationId, kind, { builtIns: false }),
        // Uploaded frames and overlays can become the design directly.
        listAssets(op.organizationId, kind === 'overlay' ? ['overlay'] : ['layout', 'overlay']),
      ]);
      return { kind, design: design ? { id: design.id, doc: design.doc } : null, library, uploads };
    }),
  );
  const referenced = [
    branding.logoAssetId,
    branding.attract.backgroundAssetId,
    output.video360.introAssetId,
    output.video360.outroAssetId,
    output.video360.music?.assetId ?? null,
    ...[output.video360.background, output.photo.background].map((b) => (b && 'assetId' in b ? b.assetId : null)),
    ...designs.flatMap((d) => [
      ...(d.design ? templateAssetIds(d.design.doc) : []),
      ...d.library.flatMap((l) => templateAssetIds(l.doc)),
    ]),
  ].filter((x): x is string => !!x);
  const assets = await assetViews(op.organizationId, [...new Set(referenced)]);

  return (
    <BrandingEditor
      eventId={event.id}
      booths={booths}
      readOnly={readOnly}
      event={{ name: event.name, date: event.date }}
      branding={branding}
      video={output.video360}
      photo={output.photo}
      endFrameQr={share.endFrameQr}
      designs={designs}
      assets={assets}
    />
  );
}
