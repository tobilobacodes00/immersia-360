import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { displaySettingsSchema } from '@immersia/shared';
import { roleCan } from '@/lib/permissions';
import { appOrigin } from '@/server/env';
import { getEvent } from '@/server/events';
import { isOnline, listDisplays, moderationLists } from '@/server/live';
import { requireOperator } from '@/server/session';
import { LiveControl } from './LiveControl';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.live');
  return { title: t('title') };
}

/** Screen 23: Live Display control (LIV-1, 3, 7, 10, 11). */
export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const op = await requireOperator({ event: ['read'] });
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await getEvent(op.organizationId, id);
  if (!event) notFound();
  const [displays, lists] = await Promise.all([
    listDisplays(op.organizationId, id),
    moderationLists(op.organizationId, id, appOrigin()),
  ]);
  return (
    <LiveControl
      eventId={event.id}
      readOnly={!roleCan(op.role, { event: ['update'] }) || event.status === 'archived'}
      origin={appOrigin()}
      initial={{
        enabled: event.liveDisplayEnabled,
        moderation: event.moderation,
        displays: displays.map((d) => ({
          id: d.id,
          name: d.name,
          layout: d.layout,
          settings: displaySettingsSchema.parse(d.settings),
          online: isOnline(d),
          lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        })),
        lists: lists ?? { pending: [], shown: [], hidden: [] },
      }}
    />
  );
}
