import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalPage, withEmail, type LegalSection } from '@/components/legal/LegalPage';
import { supportEmail } from '@/server/env';

// NEEDS LEGAL REVIEW before launch: see the note in components/legal/LegalPage.tsx.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal.privacy');
  return { title: t('metaTitle') };
}

/** The privacy notice: Immersia 360 as host and processor, operators as controllers of guest-form data. */
export default async function PrivacyPage() {
  const t = await getTranslations('legal.privacy');
  const email = supportEmail();
  const sections: LegalSection[] = [
    {
      id: 'roles',
      title: t('sections.roles.title'),
      blocks: [t('sections.roles.p1'), { list: [t('sections.roles.operator'), t('sections.roles.immersia')] }],
    },
    {
      id: 'collected',
      title: t('sections.collected.title'),
      blocks: [
        {
          list: [
            t('sections.collected.files'),
            t('sections.collected.link'),
            t('sections.collected.form'),
            t('sections.collected.email'),
            t('sections.collected.technical'),
          ],
        },
      ],
    },
    {
      id: 'why',
      title: t('sections.why.title'),
      blocks: [
        {
          list: [
            t('sections.why.deliver'),
            t('sections.why.form'),
            t('sections.why.security'),
            t('sections.why.accounts'),
          ],
        },
      ],
    },
    {
      id: 'no-trackers',
      title: t('sections.noTrackers.title'),
      blocks: [t('sections.noTrackers.p1'), t('sections.noTrackers.p2')],
    },
    {
      id: 'retention',
      title: t('sections.retention.title'),
      blocks: [
        {
          list: [
            t('sections.retention.files'),
            t('sections.retention.erase'),
            t('sections.retention.form'),
            t('sections.retention.backups'),
          ],
        },
      ],
    },
    {
      id: 'processors',
      title: t('sections.processors.title'),
      blocks: [
        t('sections.processors.p1'),
        {
          list: [
            t('sections.processors.vercel'),
            t('sections.processors.neon'),
            t('sections.processors.cloudflare'),
            t('sections.processors.resend'),
            t('sections.processors.upstash'),
            t('sections.processors.fly'),
            t('sections.processors.cloud'),
          ],
        },
        t('sections.processors.p2'),
      ],
    },
    {
      id: 'rights',
      title: t('sections.rights.title'),
      blocks: [
        t('sections.rights.p1'),
        {
          list: [
            t('sections.rights.files'),
            withEmail(t('sections.rights.form', { email }), email),
            withEmail(t('sections.rights.other', { email }), email),
          ],
        },
      ],
    },
    {
      id: 'operators',
      title: t('sections.operators.title'),
      blocks: [t('sections.operators.p1'), t('sections.operators.p2'), t('sections.operators.p3')],
    },
    { id: 'security', title: t('sections.security.title'), blocks: [t('sections.security.p1')] },
    { id: 'changes', title: t('sections.changes.title'), blocks: [t('sections.changes.p1')] },
    {
      id: 'contact',
      title: t('sections.contact.title'),
      blocks: [withEmail(t('sections.contact.p1', { email }), email)],
    },
  ];
  return <LegalPage title={t('title')} lede={t('lede')} sections={sections} />;
}
