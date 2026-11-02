import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { outputSettingsSchema, shareSettingsSchema } from '@immersia/shared';
import { roleCan } from '@/lib/permissions';
import { loadIntegrations } from '@/server/cloud/integrations';
import { getEvent } from '@/server/events';
import { requireOperator } from '@/server/session';
import { EventSetup } from './EventSetup';
import { KioskSettings } from './KioskSettings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.setup');
  return { title: t('title') };
}

/** Screen 4: event setup. */
export default async function EventSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const op = await requireOperator({ event: ['read'] });
  const [event, integrations] = await Promise.all([
    getEvent(op.organizationId, id),
    loadIntegrations(op.organizationId),
  ]);
  if (!event) notFound();
  const readOnly = !roleCan(op.role, { event: ['update'] });
  // Re-parse stored settings so older rows gain any defaults added since they were written.
  return (
    <div className="space-y-6">
      <EventSetup
        id={event.id}
        readOnly={readOnly}
        basics={{
          name: event.name,
          date: event.date,
          mode: event.mode,
          expiryDays: event.expiryDays as 7 | 30 | 90,
          filenamePrefixEnabled: event.filenamePrefixEnabled,
        }}
        output={outputSettingsSchema.parse(event.outputSettings)}
        share={shareSettingsSchema.parse(event.shareSettings)}
        cloud={{
          drive: integrations.find((i) => i.provider === 'drive')?.state ?? 'unavailable',
          dropbox: integrations.find((i) => i.provider === 'dropbox')?.state ?? 'unavailable',
        }}
      />
      <KioskSettings eventId={event.id} pinSet={event.kioskPinHash !== null} readOnly={readOnly} />
    </div>
  );
}
