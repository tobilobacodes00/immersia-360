'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { roleCan, type Permission, type RoleName } from '@/lib/permissions';

const RoleContext = createContext<RoleName>('viewer');

export function OperatorProvider({ role, children }: { role: RoleName; children: ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

/** Hide controls the role can't use. Cosmetic only — the server enforces every permission. */
export function useCan(permission: Permission): boolean {
  return roleCan(useContext(RoleContext), permission);
}
