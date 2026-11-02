import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { brandingSchema, eventBooths, eventTokens, outputSettingsSchema, templateAssetIds } from '@immersia/shared';
import { TemplateEditor } from '@/components/editor/TemplateEditor';
import { assetViews, listAssets } from '@/server/assets';
import { getEvent } from '@/server/events';
import { requireOperator } from '@/server/session';
import {
  adaptToCanvas,
  ensureEventTemplate,
  listLibraryTemplates,
  saveTemplate,
  targetCanvas,
} from '@/server/templates';

type Kind = 'layout' | 'overlay';

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }): Promise<Metadata> {
  const { kind } = await params;
  const t = await getTranslations('studio.editor');
  return { title: kind === 'overlay' ? t('titleOverlay') : t('titleLayout') };
}

/** Screen 6: the photo layout (photo events) or the video overlay (360 events). */
export default async function DesignPage({ params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind: rawKind } = await params;
  if (rawKind !== 'layout' && rawKind !== 'overlay') notFound();
  const kind: Kind = rawKind;
  const op = await requireOperator({ event: ['update'] });
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await getEvent(op.organizationId, id);
  if (!event || event.status === 'archived') notFound();
  // Photo booths print a layout; 360 booths draw an overlay over the video (either, or both: LIV-13).
  if (
    !eventBooths(event.mode, outputSettingsSchema.parse(event.outputSettings)).includes(
      kind === 'layout' ? 'photo' : 'video360',
    )
  )
    notFound();

  const record = await ensureEventTemplate(op, id, kind);
  if (!record) notFound();
  const output = outputSettingsSchema.parse(event.outputSettings);
  const branding = brandingSchema.parse(event.branding);

  // The event's print size or video aspect may have changed since this was designed: fit the design
  // to the current canvas once, here, so the editor and the booth agree on what is stored.
  const target = targetCanvas(kind, output);
  let doc = adaptToCanvas(record.doc, target.width, target.height);
  if (kind === 'layout' && doc.canvas.printSize !== output.photo.printSize)
    doc = { ...doc, canvas: { ...doc.canvas, printSize: output.photo.printSize } };
  let version = record.version;
  if (doc !== record.doc) {
    const res = await saveTemplate(op.organizationId, record.id, doc, record.version);
    if (res.ok) version = res.version;
  }

  const [assets, fonts, library] = await Promise.all([
    assetViews(op.organizationId, templateAssetIds(doc)),
    listAssets(op.organizationId, ['font']),
    listLibraryTemplates(op.organizationId, kind),
  ]);

  return (
    <TemplateEditor
      key={record.id}
      templateId={record.id}
      kind={kind}
      initialDoc={doc}
      initialVersion={version}
      event={{
        theme: branding.theme,
        tokens: eventTokens(
          { name: event.name, date: event.date },
          branding,
          { shortCode: 'K7M2PQ', url: 'https://immersia.example/s/preview' },
          { number: 1, count: output.photo.shots },
        ),
        printSize: output.photo.printSize,
        aspect: output.video360.aspect,
      }}
      assets={assets}
      fonts={fonts}
      library={library}
    />
  );
}
