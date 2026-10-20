import type { ReactNode } from 'react';
import { isAdminEmail } from '@/server/admin';
import { openReportCount } from '@/server/reports';
import { requireOperator } from '@/server/session';
import { StudioShell } from './StudioShell';

/** Operator console. Every page below is server-checked for a session (and role, per action). */
export default async function StudioLayout({ children }: { children: ReactNode }) {
  const op = await requireOperator();
  // Abuse: reports waiting for a decision show as a badge on Reports, whichever page the operator is on.
  const openReports = await openReportCount(op.organizationId).catch(() => 0);
  return (
    <StudioShell
      operator={{ name: op.name, email: op.email, organizationName: op.organizationName, role: op.role }}
      openReports={openReports}
      isAdmin={isAdminEmail(op.email)}
    >
      {children}
    </StudioShell>
  );
}
