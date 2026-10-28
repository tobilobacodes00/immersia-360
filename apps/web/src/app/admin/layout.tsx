import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { BrandMark, Pill } from '@immersia/ui';
import { requirePlatformAdmin } from '@/server/admin';
import { adminQueueCounts } from '@/server/reports';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

// Always the live state of the platform; nothing here is cached or shared.
export const dynamic = 'force-dynamic';

/**
 * The platform admin console: success metrics, the reports queue. Internal, English only. Every page
 * and every action checks the ADMIN_EMAILS allowlist itself (requirePlatformAdmin); this layout
 * checks too, so a visitor who is not an admin never sees a frame of it, only the site's 404.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requirePlatformAdmin();
  const counts = await adminQueueCounts().catch(() => ({ unresolved: 0, escalated: 0, overdue: 0 }));
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-bg">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-8">
          <Link href="/admin" className="flex items-center gap-2.5">
            <BrandMark size={28} />
            <span className="text-sm font-semibold tracking-[-0.01em]">Immersia 360 admin</span>
          </Link>
          <nav aria-label="Admin" className="flex items-center gap-1 text-sm">
            <Link
              href="/admin"
              className="focus-ring rounded-lg px-3 py-1.5 font-medium text-muted hover:bg-sunken hover:text-fg"
            >
              Metrics
            </Link>
            <Link
              href="/admin/reports"
              className="focus-ring flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium text-muted hover:bg-sunken hover:text-fg"
            >
              Reports
              {counts.unresolved > 0 && (
                <Pill tone={counts.overdue > 0 ? 'bad' : 'warn'}>
                  {counts.unresolved}
                  {counts.overdue > 0 && ` · ${counts.overdue} overdue`}
                </Pill>
              )}
            </Link>
          </nav>
          <span className="ml-auto text-[13px] text-muted">{admin.email}</span>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
        {children}
      </main>
    </div>
  );
}
