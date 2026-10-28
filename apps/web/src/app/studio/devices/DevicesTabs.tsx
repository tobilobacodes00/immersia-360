'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cx } from '@immersia/ui';

/** Screen 21 has two sections, each its own page so a link can point at either. */
export function DevicesTabs() {
  const t = useTranslations('studio.devices.tabs');
  const path = usePathname();
  const onTeam = path.startsWith('/studio/devices/team');
  const tabs = [
    { href: '/studio/devices' as const, label: t('devices'), active: !onTeam },
    { href: '/studio/devices/team' as const, label: t('team'), active: onTeam },
  ];
  return (
    <nav aria-label={t('label')} className="-mt-4 mb-6 flex gap-1 overflow-x-auto sm:-mt-5">
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
          {tab.active && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent" />}
        </Link>
      ))}
    </nav>
  );
}
