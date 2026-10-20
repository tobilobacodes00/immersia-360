'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarDays,
  Cloud,
  FolderOpen,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Menu,
  MonitorSmartphone,
  X,
  type LucideIcon,
} from 'lucide-react';
import { BrandMark, IconButton, cx, spring } from '@immersia/ui';
import { LanguagePicker } from '@/components/LanguagePicker';
import { authClient } from '@/lib/auth-client';
import type { RoleName } from '@/lib/permissions';
import { OperatorProvider } from './operator-context';

interface NavItem {
  href: Route;
  key: 'home' | 'events' | 'assets' | 'templates' | 'devices' | 'integrations';
  icon: LucideIcon;
  match: (path: string) => boolean;
}

const NAV: { group: 'overview' | 'prepare' | 'system'; items: NavItem[] }[] = [
  {
    group: 'overview',
    items: [{ href: '/studio', key: 'home', icon: LayoutDashboard, match: (p) => p === '/studio' }],
  },
  {
    group: 'prepare',
    items: [
      { href: '/studio/events', key: 'events', icon: CalendarDays, match: (p) => p.startsWith('/studio/events') },
      { href: '/studio/assets', key: 'assets', icon: FolderOpen, match: (p) => p.startsWith('/studio/assets') },
      {
        href: '/studio/templates',
        key: 'templates',
        icon: LayoutTemplate,
        match: (p) => p.startsWith('/studio/templates'),
      },
    ],
  },
  {
    group: 'system',
    items: [
      {
        href: '/studio/devices',
        key: 'devices',
        icon: MonitorSmartphone,
        match: (p) => p.startsWith('/studio/devices'),
      },
      {
        href: '/studio/integrations',
        key: 'integrations',
        icon: Cloud,
        match: (p) => p.startsWith('/studio/integrations'),
      },
    ],
  },
];

export interface ShellOperator {
  name: string;
  email: string;
  organizationName: string;
  role: RoleName;
}

function Rail({ operator, onNavigate }: { operator: ShellOperator; onNavigate?: () => void }) {
  const t = useTranslations('studio.nav');
  const tr = useTranslations('roles');
  const path = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <div className="flex h-full w-full flex-col px-3 py-4">
      <Link href="/studio" onClick={onNavigate} className="mb-6 flex items-center gap-2.5 px-2">
        <BrandMark size={30} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold tracking-[-0.01em]">{operator.organizationName}</span>
          <span className="block text-[11px] text-faint">{tr(operator.role)}</span>
        </span>
      </Link>
      <nav aria-label={t('label')} className="space-y-5">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="eyebrow mb-1.5 px-3">{t(`groups.${g.group}`)}</div>
            <div className="space-y-0.5">
              {g.items.map((n) => {
                const active = n.match(path);
                return (
                  <Link
                    key={n.key}
                    href={n.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'focus-ring relative flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors lg:h-9',
                      active ? 'bg-sunken font-semibold text-fg' : 'text-muted hover:bg-sunken/70 hover:text-fg',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-indicator"
                        transition={spring}
                        className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent"
                      />
                    )}
                    <n.icon className="size-4 shrink-0" strokeWidth={active ? 2.25 : 2} />
                    <span className="flex-1">{t(n.key)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-auto space-y-3 border-t border-line pt-4">
        <LanguagePicker />
        <div className="flex items-center gap-2 px-1">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{operator.name || operator.email}</div>
            {operator.name && <div className="truncate text-[11px] text-faint">{operator.email}</div>}
          </div>
          <IconButton
            label={t('signOut')}
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await authClient.signOut();
              router.replace('/sign-in');
              router.refresh();
            }}
          >
            <LogOut className="size-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

export function StudioShell({ operator, children }: { operator: ShellOperator; children: ReactNode }) {
  const t = useTranslations('studio.nav');
  const tc = useTranslations('common');
  const [drawer, setDrawer] = useState(false);
  // Close the mobile drawer on any navigation, including Back/Forward (adjusted during render).
  const path = usePathname();
  const [drawerPath, setDrawerPath] = useState(path);
  if (drawerPath !== path) {
    setDrawerPath(path);
    setDrawer(false);
  }
  return (
    <OperatorProvider role={operator.role}>
      <a
        href="#main"
        className="sr-only rounded-lg bg-elev px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        {tc('skipToContent')}
      </a>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-[256px] shrink-0 border-r border-line bg-bg lg:flex">
          <Rail operator={operator} />
        </aside>
        <AnimatePresence>
          {drawer && (
            <motion.div
              className="fixed inset-0 z-40 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="absolute inset-0 bg-[#111110]/30" onClick={() => setDrawer(false)} />
              <motion.aside
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={spring}
                className="absolute inset-y-0 left-0 flex w-[280px] bg-bg shadow-pop"
                aria-label={t('label')}
              >
                <Rail operator={operator} onNavigate={() => setDrawer(false)} />
              </motion.aside>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-bg/90 px-3 backdrop-blur lg:hidden">
            <IconButton label={drawer ? t('closeMenu') : t('openMenu')} onClick={() => setDrawer((d) => !d)}>
              {drawer ? <X className="size-5" /> : <Menu className="size-5" />}
            </IconButton>
            <span className="truncate text-sm font-semibold">{operator.organizationName}</span>
          </header>
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 sm:py-10">
            {children}
          </main>
        </div>
      </div>
    </OperatorProvider>
  );
}
