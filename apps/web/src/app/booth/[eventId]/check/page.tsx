import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { eventBooths, outputSettingsSchema, type BoothMode } from '@immersia/shared';
import { planCheck } from '@/lib/setup-check/config';
import { getEvent } from '@/server/events';
import { requireOperator } from '@/server/session';
import { CheckClient } from './CheckClient';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('check');
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * Screen 9, "Setup check" (HLP-1): run on the booth device itself before an event. Reached from the
 * event dashboard, the booth's settings drawer, and offered automatically the first time a device
 * opens a booth.
 */
export default async function SetupCheckPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ booth?: string }>;
}) {
  const [{ eventId }, { booth }] = await Promise.all([params, searchParams]);
  const op = await requireOperator({ event: ['run'] });
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) notFound();
  const event = await getEvent(op.organizationId, eventId);
  if (!event || event.status === 'archived') notFound();
  const output = outputSettingsSchema.parse(event.outputSettings);
  // The same booth choice as the booth page: the event's own, or its second booth (LIV-13).
  const mode: BoothMode = eventBooths(event.mode, output).find((b) => b === booth) ?? event.mode;
  return (
    <CheckClient
      eventId={event.id}
      eventName={event.name}
      mode={mode}
      plan={planCheck(mode, output)}
      boothHref={`/booth/${event.id}${mode === event.mode ? '' : `?booth=${mode}`}` as Route}
    />
  );
}
