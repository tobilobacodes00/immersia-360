import { describe, expect, it } from 'vitest';
import {
  REPORT_REASONS,
  REPORT_SLA_MS,
  formatSla,
  isUnresolved,
  removalHttpStatus,
  reportInputSchema,
  reporterDay,
  reporterHash,
  slaClock,
} from '../src/reports';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const IP = '203.0.113.42';

describe('reporterHash (salted, rotated daily)', () => {
  const monday = new Date('2026-10-19T09:00:00Z');

  it('is stable within a day, so repeat reports from one address can be limited', async () => {
    const a = await reporterHash(IP, SECRET, monday);
    const b = await reporterHash(IP, SECRET, new Date('2026-10-19T23:59:59Z'));
    expect(a).toBe(b);
  });

  it('rotates at midnight UTC, so reports cannot be linked across days', async () => {
    const a = await reporterHash(IP, SECRET, new Date('2026-10-19T23:59:59Z'));
    const b = await reporterHash(IP, SECRET, new Date('2026-10-20T00:00:00Z'));
    expect(a).not.toBe(b);
  });

  it('tells addresses apart', async () => {
    expect(await reporterHash('203.0.113.43', SECRET, monday)).not.toBe(await reporterHash(IP, SECRET, monday));
  });

  it('depends on the server secret, so it cannot be recomputed from an address alone', async () => {
    expect(await reporterHash(IP, `${SECRET}x`, monday)).not.toBe(await reporterHash(IP, SECRET, monday));
  });

  it('does not contain the address and has a fixed shape', async () => {
    const h = await reporterHash(IP, SECRET, monday);
    expect(h).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(h).not.toContain(IP);
  });

  it('names the day in UTC', () => {
    expect(reporterDay(new Date('2026-10-19T23:30:00-05:00'))).toBe('2026-10-20');
  });
});

describe('the 24-hour SLA clock', () => {
  const created = new Date('2026-10-19T10:00:00Z');

  it('is due 24 hours after the report', () => {
    const clock = slaClock(created, new Date('2026-10-19T12:30:00Z'));
    expect(clock.dueAt.toISOString()).toBe('2026-10-20T10:00:00.000Z');
    expect(clock.remainingMs).toBe(REPORT_SLA_MS - 2.5 * 3_600_000);
    expect(clock.overdue).toBe(false);
  });

  it('is overdue the moment the deadline passes, not before', () => {
    expect(slaClock(created, new Date('2026-10-20T10:00:00Z')).overdue).toBe(false);
    expect(slaClock(created, new Date('2026-10-20T10:00:01Z')).overdue).toBe(true);
  });

  it('says how long is left or how late it is', () => {
    expect(formatSla(3 * 3_600_000 + 12 * 60_000)).toBe('3h 12m left');
    expect(formatSla(-(2 * 3_600_000 + 5 * 60_000))).toBe('2h 5m overdue');
    expect(formatSla(9 * 60_000)).toBe('9m left');
  });

  it('keeps running while a report is escalated, and stops when it is decided', () => {
    expect(isUnresolved('open')).toBe(true);
    expect(isUnresolved('escalated')).toBe(true);
    expect(isUnresolved('actioned')).toBe(false);
    expect(isUnresolved('dismissed')).toBe(false);
  });
});

describe('what a removed page answers', () => {
  it('is 451 for illegal content and 410 for everything else', () => {
    expect(removalHttpStatus('legal')).toBe(451);
    expect(removalHttpStatus('policy')).toBe(410);
    expect(removalHttpStatus('operator')).toBe(410);
  });
});

describe('the guest report form', () => {
  it('offers the database reasons', () => {
    expect([...REPORT_REASONS]).toEqual(['not_me', 'inappropriate', 'illegal', 'privacy', 'other']);
  });

  it('accepts a reason alone; details and contact are optional', () => {
    expect(reportInputSchema.parse({ reason: 'not_me', details: '', contact: '' })).toEqual({
      reason: 'not_me',
      details: null,
      contact: null,
    });
  });

  it('trims details and checks the contact address', () => {
    expect(
      reportInputSchema.parse({ reason: 'privacy', details: '  that is my child  ', contact: ' mum@example.com ' }),
    ).toEqual({ reason: 'privacy', details: 'that is my child', contact: 'mum@example.com' });
    expect(reportInputSchema.safeParse({ reason: 'other', details: '', contact: 'not an email' }).success).toBe(false);
  });

  it('refuses an unknown reason and over-long details', () => {
    expect(reportInputSchema.safeParse({ reason: 'spam', details: '', contact: '' }).success).toBe(false);
    expect(reportInputSchema.safeParse({ reason: 'other', details: 'x'.repeat(1001), contact: '' }).success).toBe(
      false,
    );
  });
});
