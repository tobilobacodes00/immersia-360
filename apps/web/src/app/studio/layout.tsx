import type { ReactNode } from 'react';
import { requireOperator } from '@/server/session';
import { StudioShell } from './StudioShell';

/** Operator console. Every page below is server-checked for a session (and role, per action). */
export default async function StudioLayout({ children }: { children: ReactNode }) {
  const op = await requireOperator();
  return (
    <StudioShell operator={{ name: op.name, email: op.email, organizationName: op.organizationName, role: op.role }}>
      {children}
    </StudioShell>
  );
}
