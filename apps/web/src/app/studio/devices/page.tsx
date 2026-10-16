import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@immersia/ui';
import { listDevices } from '@/server/devices';
import { requireOperator } from '@/server/session';
import { DeviceList, type DeviceView } from './DeviceList';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.devices');
  return { title: t('title') };
}

/** Screen 21 (devices): unlimited devices per account, named, last seen, revocable (ACC-2). */
export default async function DevicesPage() {
  const op = await requireOperator({ device: ['read'] });
  const [t, rows] = await Promise.all([getTranslations('studio.devices'), listDevices(op.organizationId)]);
  const devices: DeviceView[] = rows.map((d) => ({
    id: d.id,
    name: d.name,
    platform: d.platform,
    browser: d.browser,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    revoked: Boolean(d.revokedAt),
    renderPath: d.capabilities.renderPath,
  }));
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <DeviceList devices={devices} />
    </>
  );
}
