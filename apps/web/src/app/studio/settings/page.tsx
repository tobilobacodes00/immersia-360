import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Download } from 'lucide-react';
import { Card, PageHeader, buttonClass } from '@immersia/ui';
import { roleCan } from '@/lib/permissions';
import { requireOperator } from '@/server/session';
import { DeleteOrganization } from './DeleteOrganization';
import { PrivacyRequests } from './PrivacyRequests';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.settings');
  return { title: t('title') };
}

/**
 * Account settings and the operator's privacy tools: guests' deletion requests (owners and
 * operators), a full export of the organization's data and deleting the organization (owner only).
 */
export default async function SettingsPage() {
  const op = await requireOperator();
  const [t, tr] = await Promise.all([getTranslations('studio.settings'), getTranslations('roles')]);
  const canHandleRequests = roleCan(op.role, { guest: ['delete'] });
  const isOwner = roleCan(op.role, { account: ['export'] });
  const canDeleteOrg = roleCan(op.role, { organization: ['delete'] });
  return (
    <>
      <PageHeader eyebrow={op.organizationName} title={t('title')} subtitle={t('subtitle')} />
      <div className="space-y-6">
        <Card title={t('organization.title')}>
          <dl className="divide-y divide-line text-sm">
            <div className="flex justify-between gap-4 py-3.5">
              <dt className="text-muted">{t('organization.name')}</dt>
              <dd className="font-medium">{op.organizationName}</dd>
            </div>
            <div className="flex justify-between gap-4 py-3.5">
              <dt className="text-muted">{t('organization.role')}</dt>
              <dd className="font-medium">{tr(op.role)}</dd>
            </div>
          </dl>
        </Card>

        <Card id="privacy" title={t('requests.title')} subtitle={t('requests.subtitle')}>
          {canHandleRequests ? (
            <PrivacyRequests />
          ) : (
            <p className="py-4 text-sm text-muted">{t('requests.forbidden')}</p>
          )}
        </Card>

        <Card title={t('export.title')} subtitle={t('export.body')}>
          <div className="py-4">
            {isOwner ? (
              <a href="/api/studio/export" download className={buttonClass()}>
                <Download className="size-4" aria-hidden /> {t('export.button')}
              </a>
            ) : (
              <p className="text-sm text-muted">{t('export.ownerOnly')}</p>
            )}
          </div>
        </Card>

        <Card title={t('delete.title')} subtitle={t('delete.body', { name: op.organizationName })}>
          <div className="py-4">
            {canDeleteOrg ? (
              <DeleteOrganization name={op.organizationName} />
            ) : (
              <p className="text-sm text-muted">{t('delete.ownerOnly')}</p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
