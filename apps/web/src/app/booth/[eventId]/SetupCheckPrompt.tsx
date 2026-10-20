'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { ClipboardCheck } from 'lucide-react';
import { Button, buttonClass } from '@immersia/ui';

/**
 * HLP-1: shown on a booth's start screen the first time a device opens a booth. Skippable, and the
 * choice is remembered for this device (see use-setup-check-prompt.ts).
 */
export function SetupCheckPrompt({ href, onSkip }: { href: string; onSkip: () => void }) {
  const t = useTranslations('booth.setupPrompt');
  return (
    <section
      aria-labelledby="setup-prompt-title"
      className="card mt-10 flex max-w-lg flex-col items-center gap-3 p-5 text-center text-fg"
      style={{ fontSize: 15 }}
    >
      <ClipboardCheck className="size-6 text-accent" aria-hidden />
      <h2 id="setup-prompt-title" className="text-base font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm leading-relaxed text-muted">{t('body')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href={href as Route} className={buttonClass({ variant: 'primary' })}>
          {t('run')}
        </Link>
        <Button onClick={onSkip}>{t('skip')}</Button>
      </div>
    </section>
  );
}
