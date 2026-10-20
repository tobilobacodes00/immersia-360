import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/organization/access';

/**
 * Roles (ACC-3): owner, operator, viewer. Shared by server and client so the UI hides what the
 * server would refuse. The server is always the authority.
 */
export const statements = {
  ...defaultStatements,
  event: ['create', 'read', 'update', 'archive', 'delete', 'run'],
  device: ['register', 'read', 'revoke'],
  asset: ['create', 'read', 'delete'],
  integration: ['connect', 'disconnect'],
  gallery: ['export'],
  /** Guest form contacts (SHR-6): personal data, so only owners and operators handle them. */
  guest: ['read', 'export', 'delete'],
  /** The organization's own data export (privacy): the account holder only. */
  account: ['export'],
} as const;

export const ac = createAccessControl(statements);

export const owner = ac.newRole({
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  event: ['create', 'read', 'update', 'archive', 'delete', 'run'],
  device: ['register', 'read', 'revoke'],
  asset: ['create', 'read', 'delete'],
  integration: ['connect', 'disconnect'],
  gallery: ['export'],
  guest: ['read', 'export', 'delete'],
  account: ['export'],
});

/** An assistant who runs booths: everything about events and devices, nothing about the team. */
export const operator = ac.newRole({
  event: ['create', 'read', 'update', 'archive', 'run'],
  device: ['register', 'read'],
  asset: ['create', 'read', 'delete'],
  gallery: ['export'],
  guest: ['read', 'export', 'delete'],
});

/** Read-only: sees events, galleries and devices; can export a gallery for a client. */
export const viewer = ac.newRole({
  event: ['read'],
  device: ['read'],
  asset: ['read'],
  gallery: ['export'],
});

export const roles = { owner, operator, viewer };
export type RoleName = keyof typeof roles;
export type Permission = { [K in keyof typeof statements]?: (typeof statements)[K][number][] };

export function isRoleName(value: string): value is RoleName {
  return value in roles;
}

/** Pure check used by both server guards and client UI. */
export function roleCan(role: string, permission: Permission): boolean {
  if (!isRoleName(role)) return false;
  return roles[role].authorize(permission as never).success;
}
