import { describe, expect, it } from 'vitest';
import { isRoleName, roleCan, roles, statements, type Permission, type RoleName } from './permissions';

/** Every (resource, action) pair the console knows, e.g. ["event", "create"]. */
const ALL = Object.entries(statements).flatMap(([resource, actions]) =>
  (actions as readonly string[]).map((action) => [resource, action] as const),
);

/** One (resource, action) pair as a permission. The names come from `statements`, so the cast is safe. */
const can = (role: string, resource: string, action: string) => roleCan(role, { [resource]: [action] } as Permission);

const allowed = (role: string) => ALL.filter(([resource, action]) => can(role, resource, action));
const key = ([resource, action]: readonly [string, string]) => `${resource}:${action}`;

describe('role permissions (ACC-3)', () => {
  it('viewers can read and export galleries, and nothing else', () => {
    expect(allowed('viewer').map(key).sort()).toEqual(['asset:read', 'device:read', 'event:read', 'gallery:export']);
  });

  it('operators run events and devices but have no say over the team, clouds or revoking devices', () => {
    expect(allowed('operator').map(key).sort()).toEqual(
      [
        'asset:create',
        'asset:delete',
        'asset:read',
        'device:read',
        'device:register',
        'event:archive',
        'event:create',
        'event:read',
        'event:run',
        'event:update',
        'gallery:export',
      ].sort(),
    );
    for (const denied of [
      { member: ['create'] },
      { member: ['update'] },
      { member: ['delete'] },
      { invitation: ['create'] },
      { invitation: ['cancel'] },
      { organization: ['update'] },
      { organization: ['delete'] },
      { integration: ['connect'] },
      { integration: ['disconnect'] },
      { device: ['revoke'] },
      { event: ['delete'] },
    ] satisfies Permission[])
      expect(roleCan('operator', denied), JSON.stringify(denied)).toBe(false);
  });

  it('owners manage the team, invitations and everything an operator can', () => {
    for (const permission of [
      { member: ['create', 'update', 'delete'] },
      { invitation: ['create', 'cancel'] },
      { organization: ['update', 'delete'] },
      { integration: ['connect', 'disconnect'] },
      { device: ['register', 'read', 'revoke'] },
      { event: ['create', 'read', 'update', 'archive', 'delete', 'run'] },
    ] satisfies Permission[])
      expect(roleCan('owner', permission), JSON.stringify(permission)).toBe(true);
  });

  it('is a strict ladder: whatever a viewer can do an operator can, and whatever an operator can do an owner can', () => {
    const owner = new Set(allowed('owner').map(key));
    const operator = new Set(allowed('operator').map(key));
    for (const p of allowed('viewer').map(key)) expect(operator.has(p), `operator lacks ${p}`).toBe(true);
    for (const p of operator) expect(owner.has(p), `owner lacks ${p}`).toBe(true);
    expect(owner.size).toBeGreaterThan(operator.size);
    expect(operator.size).toBeGreaterThan(allowed('viewer').length);
  });

  it('a viewer holds no permission to create, update, delete, revoke, connect or run anything', () => {
    const readOnly = new Set(['read', 'export']);
    for (const [resource, action] of ALL.filter(([, action]) => !readOnly.has(action)))
      expect(can('viewer', resource, action), `${resource}:${action}`).toBe(false);
  });

  it('denies anything that is not exactly one of the three roles', () => {
    for (const role of [
      '',
      'admin',
      'member',
      'owner,viewer',
      'viewer,operator',
      'constructor',
      'toString',
      '__proto__',
    ])
      expect(roleCan(role, { event: ['read'] }), role).toBe(false);
  });

  it('knows its role names by own keys only', () => {
    expect(Object.keys(roles).sort()).toEqual(['operator', 'owner', 'viewer']);
    const names: RoleName[] = ['owner', 'operator', 'viewer'];
    for (const n of names) expect(isRoleName(n)).toBe(true);
    for (const n of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'Owner', ''])
      expect(isRoleName(n), n).toBe(false);
  });
});
