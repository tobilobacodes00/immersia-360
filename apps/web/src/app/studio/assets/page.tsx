import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CloudOff } from 'lucide-react';
import { EmptyState, PageHeader } from '@immersia/ui';
import { listAssets } from '@/server/assets';
import { requireOperator } from '@/server/session';
import { storageConfigured } from '@/server/storage';
import { AssetLibrary } from './AssetLibrary';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.assets');
  return { title: t('title') };
}

/** Screen 8 (assets library): overlays, intros, outros, music, fonts, logos and backgrounds. */
export default async function AssetsPage() {
  const op = await requireOperator({ asset: ['read'] });
  const t = await getTranslations('studio.assets');
  // Self-hosted without a bucket: say so, rather than failing on the first signed URL.
  const assets = storageConfigured() ? await listAssets(op.organizationId) : null;
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {assets ? (
        <AssetLibrary initial={assets} />
      ) : (
        <div className="card">
          <EmptyState
            icon={<CloudOff className="size-5" />}
            title={t('storageOff.title')}
            body={t('storageOff.body')}
          />
        </div>
      )}
    </>
  );
}
