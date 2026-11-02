import { describe, expect, it } from 'vitest';
import {
  FAIR_USE_BYTES,
  METRIC_TARGETS,
  costPerOperator,
  fairUseLevel,
  fairUseShare,
  metricStatus,
  monthBuckets,
  monthKey,
  parseMonthKey,
  parseWindow,
  percentileCont,
  ratio,
  weekBuckets,
  weekStart,
} from '../src/metrics';

describe('the PRD targets', () => {
  it('are the six figures the PRD names', () => {
    expect(METRIC_TARGETS.captureToQr).toEqual({ target: 60, direction: 'atMost' });
    expect(METRIC_TARGETS.crashFreeEvents).toEqual({ target: 0.99, direction: 'atLeast' });
    expect(METRIC_TARGETS.downloadSuccess).toEqual({ target: 0.97, direction: 'atLeast' });
    expect(METRIC_TARGETS.multiEventOperators).toEqual({ target: 0.35, direction: 'atLeast' });
    expect(METRIC_TARGETS.devicesPerOperator).toEqual({ target: 1.5, direction: 'atLeast' });
    expect(METRIC_TARGETS.costPerOperator).toEqual({ target: 0.4, direction: 'atMost' });
  });
});

describe('ratio and metricStatus', () => {
  it('treats no data as no data, never as 0% or 100%', () => {
    expect(ratio(0, 0)).toBeNull();
    expect(metricStatus(ratio(0, 0), METRIC_TARGETS.downloadSuccess)).toBe('no_data');
    expect(metricStatus(Number.NaN, METRIC_TARGETS.captureToQr)).toBe('no_data');
  });

  it('meets an at-least target exactly at the target and misses just below it', () => {
    expect(metricStatus(0.97, METRIC_TARGETS.downloadSuccess)).toBe('meets');
    expect(metricStatus(ratio(969, 1000), METRIC_TARGETS.downloadSuccess)).toBe('misses');
    expect(metricStatus(ratio(99, 100), METRIC_TARGETS.crashFreeEvents)).toBe('meets');
  });

  it('meets an at-most target exactly at the target and misses just above it', () => {
    expect(metricStatus(60, METRIC_TARGETS.captureToQr)).toBe('meets');
    expect(metricStatus(60.01, METRIC_TARGETS.captureToQr)).toBe('misses');
    expect(metricStatus(0.4, METRIC_TARGETS.costPerOperator)).toBe('meets');
  });
});

describe('costPerOperator', () => {
  it('divides the bill (in cents) by the monthly active operators', () => {
    expect(costPerOperator(40_000, 1000)).toBeCloseTo(0.4, 10);
    expect(costPerOperator(12_345, 100)).toBeCloseTo(1.2345, 10);
  });

  it('has no answer without a bill or without operators', () => {
    expect(costPerOperator(null, 10)).toBeNull();
    expect(costPerOperator(10_000, 0)).toBeNull();
  });
});

describe('fair use', () => {
  it('is 50 GB (decimal)', () => {
    expect(FAIR_USE_BYTES).toBe(50_000_000_000);
  });

  it('warns from 80% and flags the ceiling', () => {
    expect(fairUseLevel(fairUseShare(10e9))).toBe('ok');
    expect(fairUseLevel(fairUseShare(40e9))).toBe('near');
    expect(fairUseLevel(fairUseShare(50e9))).toBe('over');
    expect(fairUseShare(75e9)).toBeCloseTo(1.5, 10);
    expect(fairUseShare(-5)).toBe(0);
  });
});

describe('percentileCont (the reference for the SQL)', () => {
  it('interpolates like Postgres percentile_cont', () => {
    expect(percentileCont([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentileCont([10, 20, 30, 40, 50], 0.9)).toBeCloseTo(46, 10);
    expect(percentileCont([5], 0.9)).toBe(5);
    expect(percentileCont([4, 1, 3, 2], 0)).toBe(1);
    expect(percentileCont([4, 1, 3, 2], 1)).toBe(4);
  });

  it('is unaffected by input order and clamps p', () => {
    expect(percentileCont([9, 1, 5], 0.5)).toBe(5);
    expect(percentileCont([1, 2, 3], 2)).toBe(3);
  });

  it('has no answer for no values', () => {
    expect(percentileCont([], 0.5)).toBeNull();
  });
});

describe('time buckets', () => {
  it('starts the week on Monday, UTC', () => {
    // 2026-10-19 is a Monday
    expect(weekStart(new Date('2026-10-19T00:00:00Z')).toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(weekStart(new Date('2026-10-25T23:59:59Z')).toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(weekStart(new Date('2026-10-26T00:00:00Z')).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });

  it('covers the window in whole weeks, oldest first', () => {
    const weeks = weekBuckets(new Date('2026-10-20T10:00:00Z'), 30);
    expect(weeks[0]!.toISOString()).toBe('2026-09-21T00:00:00.000Z');
    expect(weeks.at(-1)!.toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(weeks).toHaveLength(5);
    const ninety = weekBuckets(new Date('2026-10-20T10:00:00Z'), 90);
    expect(ninety.length).toBeGreaterThanOrEqual(13);
    expect(ninety.length).toBeLessThanOrEqual(14);
  });

  it('lists the billing months a window touches', () => {
    const months = monthBuckets(new Date('2026-10-20T10:00:00Z'), 90).map(monthKey);
    expect(months).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
  });

  it('round-trips a month key and refuses nonsense', () => {
    expect(parseMonthKey('2026-10')?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(parseMonthKey('2026-13')).toBeNull();
    expect(parseMonthKey('2026-1')).toBeNull();
    expect(parseMonthKey('October')).toBeNull();
  });

  it('offers 30 or 90 days, defaulting to 90', () => {
    expect(parseWindow('30')).toBe(30);
    expect(parseWindow('90')).toBe(90);
    expect(parseWindow('7')).toBe(90);
    expect(parseWindow(undefined)).toBe(90);
  });
});
