import { describe, expect, it } from 'vitest';
import { roleCan } from './permissions';

/** The privacy decisions (SHR-6): who can see, export and delete guests' personal data. */
describe('guest data permissions', () => {
  it('owners and operators handle guest contacts', () => {
    for (const role of ['owner', 'operator']) {
      expect(roleCan(role, { guest: ['read'] }), `${role} read`).toBe(true);
      expect(roleCan(role, { guest: ['export'] }), `${role} export`).toBe(true);
      expect(roleCan(role, { guest: ['delete'] }), `${role} delete`).toBe(true);
    }
  });

  it('viewers see no personal data at all (counts are shown without a permission)', () => {
    for (const action of ['read', 'export', 'delete'] as const)
      expect(roleCan('viewer', { guest: [action] }), action).toBe(false);
  });

  it('only the owner exports or deletes the organization', () => {
    expect(roleCan('owner', { account: ['export'] })).toBe(true);
    expect(roleCan('operator', { account: ['export'] })).toBe(false);
    expect(roleCan('viewer', { account: ['export'] })).toBe(false);
    expect(roleCan('owner', { organization: ['delete'] })).toBe(true);
    expect(roleCan('operator', { organization: ['delete'] })).toBe(false);
    expect(roleCan('viewer', { organization: ['delete'] })).toBe(false);
  });

  it('refuses an unknown role', () => {
    expect(roleCan('guest', { guest: ['read'] })).toBe(false);
  });
});
