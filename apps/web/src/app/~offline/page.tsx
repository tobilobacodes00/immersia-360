import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WifiOff } from 'lucide-react';
import { EmptyState } from '@immersia/ui';

export const metadata: Metadata = { title: 'Offline', robots: { index: false } };

/** Served by the service worker for any page that isn't cached while the device is offline. */
export default async function OfflinePage() {
  const t = await getTranslations('common');
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <EmptyState icon={<WifiOff className="size-5" />} title={t('appName')} body={t('offline')} />
    </main>
  );
}
