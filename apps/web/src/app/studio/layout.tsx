import type { ReactNode } from 'react';
import { requireOperator } from '@/server/session';
import { organizationsOf } from '@/server/team-data';
import { StudioShell } from './StudioShell';

/** Operator console. Every page below is server-checked for a session (and role, per action). */
export default async function StudioLayout({ children }: { children: ReactNode }) {
  const op = await requireOperator();
  const organizations = await organizationsOf(op.userId);
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
    >
      {children}
    </StudioShell>
  );
}
