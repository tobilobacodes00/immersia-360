import { describe, expect, it } from 'vitest';
import { isAdminEmail, parseAdminEmails } from './admin-allowlist';

describe('ADMIN_EMAILS', () => {
  it('lists addresses separated by commas, spaces or semicolons, lower-cased', () => {
    expect(parseAdminEmails('Ana@Example.com, bo@example.com;cy@example.com  di@example.com')).toEqual([
      'ana@example.com',
      'bo@example.com',
      'cy@example.com',
      'di@example.com',
    ]);
  });

  it('is empty when unset, and nobody is an admin then', () => {
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails('')).toEqual([]);
    expect(isAdminEmail('ana@example.com', parseAdminEmails(undefined))).toBe(false);
  });

  it('ignores entries that are not addresses', () => {
    expect(parseAdminEmails('ana@example.com, everyone, *')).toEqual(['ana@example.com']);
  });

  it('matches an address in full and ignoring case, never by domain or pattern', () => {
    const list = parseAdminEmails('ana@example.com');
    expect(isAdminEmail('ANA@example.com', list)).toBe(true);
    expect(isAdminEmail(' ana@example.com ', list)).toBe(true);
    expect(isAdminEmail('bo@example.com', list)).toBe(false);
    expect(isAdminEmail('ana@example.com.evil.test', list)).toBe(false);
    expect(isAdminEmail('xana@example.com', list)).toBe(false);
    expect(isAdminEmail('', list)).toBe(false);
    expect(isAdminEmail(null, list)).toBe(false);
  });
});
