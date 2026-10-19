'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { cx, spring } from '@immersia/ui';

export function EventTabs({ id }: { id: string }) {
  const t = useTranslations('studio.eventTabs');
  const path = usePathname();
  const base = `/studio/events/${id}` as const;
  const tabs = [
    { href: base, label: t('overview'), active: path === base },
    { href: `${base}/setup` as const, label: t('setup'), active: path.startsWith(`${base}/setup`) },
    {
      href: `${base}/branding` as const,
      label: t('branding'),
      // The editor (screen 6) is reached from branding, so it keeps that tab lit.
      active: path.startsWith(`${base}/branding`) || path.startsWith(`${base}/design`),
    },
  ];
  return (
    <nav aria-label={t('label')} className="-mb-px mt-5 flex gap-1 overflow-x-auto">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          className={cx(
            'focus-ring relative px-3 pt-1 pb-3 text-sm font-medium whitespace-nowrap transition-colors',
            tab.active ? 'text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {tab.label}
          {tab.active && (
            <motion.span
              layoutId={`event-tab-${id}`}
              transition={spring}
              className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent"
            />
          )}
        </Link>
      ))}
    </nav>
  );
}
