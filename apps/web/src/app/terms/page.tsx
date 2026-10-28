import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LegalPage, withEmail, type LegalSection } from '@/components/legal/LegalPage';
import { supportEmail } from '@/server/env';

// NEEDS LEGAL REVIEW before launch: see the note in components/legal/LegalPage.tsx. In particular
// there is deliberately no governing-law or venue clause: that is a decision for the operating entity.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal.terms');
  return { title: t('metaTitle') };
}

/** Terms of use: the rules for operators and guests of the hosted service. */
export default async function TermsPage() {
  const t = await getTranslations('legal.terms');
  const email = supportEmail();
  const sections: LegalSection[] = [
    { id: 'agreement', title: t('sections.agreement.title'), blocks: [t('sections.agreement.p1')] },
    { id: 'service', title: t('sections.service.title'), blocks: [t('sections.service.p1')] },
    {
      id: 'operators',
      title: t('sections.operators.title'),
      blocks: [
        t('sections.operators.p1'),
        {
          list: [
            t('sections.operators.i1'),
            t('sections.operators.i2'),
            t('sections.operators.i3'),
            t('sections.operators.i4'),
          ],
        },
      ],
    },
    {
      id: 'acceptable',
      title: t('sections.acceptable.title'),
      blocks: [
        t('sections.acceptable.p1'),
        { list: [t('sections.acceptable.i1'), t('sections.acceptable.i2'), t('sections.acceptable.i3')] },
        t('sections.acceptable.p2'),
      ],
    },
    { id: 'content', title: t('sections.content.title'), blocks: [t('sections.content.p1')] },
    {
      id: 'guests',
      title: t('sections.guests.title'),
      blocks: [withEmail(t('sections.guests.p1', { email }), email)],
    },
    {
      id: 'privacy',
      title: t('sections.privacy.title'),
      blocks: [
        t.rich('sections.privacy.p1', {
          link: (chunks) => (
            <Link href="/privacy" className="focus-ring rounded font-medium text-accent underline underline-offset-4">
              {chunks}
            </Link>
          ),
        }),
      ],
    },
    { id: 'liability', title: t('sections.liability.title'), blocks: [t('sections.liability.p1')] },
    { id: 'ending', title: t('sections.ending.title'), blocks: [t('sections.ending.p1')] },
    { id: 'changes', title: t('sections.changes.title'), blocks: [t('sections.changes.p1')] },
    {
      id: 'contact',
      title: t('sections.contact.title'),
      blocks: [withEmail(t('sections.contact.p1', { email }), email)],
    },
  ];
  return <LegalPage title={t('title')} lede={t('lede')} sections={sections} />;
}
