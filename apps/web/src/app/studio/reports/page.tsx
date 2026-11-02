import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Flag } from 'lucide-react';
import { Card, EmptyState, PageHeader } from '@immersia/ui';
import { reportsForOrganization } from '@/server/reports';
import { requireOperator } from '@/server/session';
import { ReportList } from './ReportList';
import { toReportView } from './views';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('studio.reports');
  return { title: t('title') };
}

/** Abuse reports against any of the organization's events, unresolved first. */
export default async function ReportsPage() {
  const op = await requireOperator({ report: ['read'] });
  const [t, locale, items] = await Promise.all([
    getTranslations('studio.reports'),
    getLocale(),
    reportsForOrganization(op.organizationId),
  ]);
  return (
    <>
      <PageHeader eyebrow={op.organizationName} title={t('title')} subtitle={t('subtitle')} />
      <Card pad={items.length > 0}>
        {items.length === 0 ? (
          <EmptyState icon={<Flag className="size-5" />} title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ReportList items={items.map((i) => toReportView(i, locale))} showEvent />
        )}
      </Card>
    </>
  );
}
