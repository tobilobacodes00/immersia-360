import type { ReactNode } from 'react';
import { isAdminEmail } from '@/server/admin';
import { openReportCount } from '@/server/reports';
import { requireOperator } from '@/server/session';
import { organizationsOf } from '@/server/team-data';
import { StudioShell } from './StudioShell';

/** Operator console. Every page below is server-checked for a session (and role, per action). */
export default async function StudioLayout({ children }: { children: ReactNode }) {
  const op = await requireOperator();
  const [organizations, openReports] = await Promise.all([
    organizationsOf(op.userId),
    // Abuse: reports waiting for a decision show as a badge on Reports, whichever page the operator is on.
    openReportCount(op.organizationId).catch(() => 0),
  ]);
  return (
    <StudioShell
      operator={{
        name: op.name,
        email: op.email,
        organizationId: op.organizationId,
        organizationName: op.organizationName,
        role: op.role,
      }}
      organizations={organizations}
      openReports={openReports}
      isAdmin={isAdminEmail(op.email)}
    >
      {children}
    </StudioShell>
  );
}
