import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@immersia/ui';
import { DevicesTabs } from './DevicesTabs';

/** Screen 21, "Devices and team": the header and the two sections (devices, team). */
export default async function DevicesLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('studio.devices');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <DevicesTabs />
      {children}
    </>
  );
}
