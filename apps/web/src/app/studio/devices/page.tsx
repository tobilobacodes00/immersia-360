import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { HelpLink } from '@/components/HelpLink';
import { HELP_ARTICLES } from '@/lib/help-links';
import { listDevices } from '@/server/devices';
import { requireOperator } from '@/server/session';
import { DeviceList, type DeviceView } from './DeviceList';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.devices.tabs');
  return { title: t('devices') };
}

/** Screen 21, devices section: unlimited devices per account, named, last seen, revocable (ACC-2). */
export default async function DevicesPage() {
  const op = await requireOperator({ device: ['read'] });
  const rows = await listDevices(op.organizationId);
  const devices: DeviceView[] = rows.map((d) => ({
    id: d.id,
    name: d.name,
    platform: d.platform,
    browser: d.browser,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    revoked: Boolean(d.revokedAt),
    renderPath: d.capabilities.renderPath,
  }));
  const th = await getTranslations('help.links');
  return (
    <>
      <div className="mb-4">
        <HelpLink slug={HELP_ARTICLES.devices} label={th('devices')} />
      </div>
      <DeviceList devices={devices} />
    </>
  );
}
