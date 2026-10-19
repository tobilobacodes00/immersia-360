import { describe, expect, it } from 'vitest';
import { formatBytes, formatClock, formatEventDate, formatRelative, formatSpan, todayIso } from './format';

describe('format', () => {
  it('formats bytes with sensible precision', () => {
    expect(formatBytes(0, 'en')).toBe('0 bytes');
    expect(formatBytes(950, 'en')).toBe('950 bytes');
    expect(formatBytes(8_400_000, 'en')).toBe('8.4 MB');
    expect(formatBytes(12_000_000_000, 'en')).toBe('12 GB');
  });

  it('formats running times and limits', () => {
    expect(formatClock(7_400)).toBe('0:07');
    expect(formatClock(201_000)).toBe('3:21');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatSpan(30_000, 'en')).toBe('30 seconds');
    expect(formatSpan(900_000, 'en')).toBe('15 minutes');
  });

  it('never shifts an event date across midnight', () => {
    expect(formatEventDate('2026-10-16', 'en', 'long')).toBe('October 16, 2026');
    expect(formatEventDate('2026-01-01', 'pt', 'long')).toBe('1 de janeiro de 2026');
  });

  it('formats relative time', () => {
    const now = Date.UTC(2026, 9, 16, 12);
    expect(formatRelative(new Date(now - 30_000), 'en', now)).toBe('30 seconds ago');
    expect(formatRelative(new Date(now - 3 * 3600_000), 'en', now)).toBe('3 hours ago');
    expect(formatRelative(new Date(now - 86400_000), 'en', now)).toBe('yesterday');
  });

  it('gives today as YYYY-MM-DD', () => {
    expect(todayIso('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
