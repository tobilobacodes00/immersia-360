/**
 * The success metrics (PRD "Success metrics", measured 90 days after launch) and the arithmetic
 * the admin page applies to what the database returns. The heavy lifting (percentiles over
 * millions of rows) happens in SQL; what lives here is small, pure and tested: targets, ratios,
 * pass/fail, weekly buckets, cost per operator and the fair-use share.
 */

export type MetricId =
  | 'captureToQr'
  | 'crashFreeEvents'
  | 'downloadSuccess'
  | 'multiEventOperators'
  | 'devicesPerOperator'
  | 'costPerOperator';

export interface MetricTarget {
  /** The PRD's figure, in the metric's own unit (seconds, a 0–1 share, a count, US dollars). */
  target: number;
  /** `atLeast`: higher is better. `atMost`: lower is better. */
  direction: 'atLeast' | 'atMost';
}

export const METRIC_TARGETS: Record<MetricId, MetricTarget> = {
  // p90 of qr_shown.seconds_since_take, for a 15 s 360 clip at 1080p on a 2022+ laptop
  captureToQr: { target: 60, direction: 'atMost' },
  crashFreeEvents: { target: 0.99, direction: 'atLeast' },
  downloadSuccess: { target: 0.97, direction: 'atLeast' },
  multiEventOperators: { target: 0.35, direction: 'atLeast' },
  devicesPerOperator: { target: 1.5, direction: 'atLeast' },
  costPerOperator: { target: 0.4, direction: 'atMost' },
};

/** The windows the admin offers, in days. */
export const METRIC_WINDOWS = [30, 90] as const;
export type MetricWindow = (typeof METRIC_WINDOWS)[number];

export function parseWindow(value: string | null | undefined): MetricWindow {
  return Number(value) === 30 ? 30 : 90;
}

/** The fair-use ceiling on stored guest files and library assets per organization (decimal GB). */
export const FAIR_USE_BYTES = 50 * 1000 ** 3;

export type MetricStatus = 'meets' | 'misses' | 'no_data';

/** `part / whole`, or null when there is nothing to divide by (no data is not 0%). */
export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export function metricStatus(value: number | null, metric: MetricTarget): MetricStatus {
  if (value === null || !Number.isFinite(value)) return 'no_data';
  const ok = metric.direction === 'atLeast' ? value >= metric.target : value <= metric.target;
  return ok ? 'meets' : 'misses';
}

/**
 * Monthly infrastructure cost per monthly active operator (PRD: ≤ $0.40). The bill is entered in
 * cents, so the division never meets a floating-point dollar amount.
 */
export function costPerOperator(billCents: number | null, activeOperators: number): number | null {
  if (billCents === null || activeOperators <= 0) return null;
  return billCents / 100 / activeOperators;
}

/** Share of the fair-use ceiling in use (1 = at the ceiling; can exceed 1). */
export function fairUseShare(bytes: number, ceiling = FAIR_USE_BYTES): number {
  return ceiling > 0 ? Math.max(0, bytes) / ceiling : 0;
}

export type FairUseLevel = 'ok' | 'near' | 'over';

/** `near` from 80% of the ceiling, so an operator is spoken to before they reach it. */
export function fairUseLevel(share: number): FairUseLevel {
  return share >= 1 ? 'over' : share >= 0.8 ? 'near' : 'ok';
}

// ---------------------------------------------------------------------------------------------
// Time buckets

const DAY_MS = 86_400_000;

/** Monday 00:00 UTC of the week containing `date`: the same boundary as Postgres `date_trunc('week', …)`. */
export function weekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - sinceMonday * DAY_MS);
}

/** The week starts covering the last `days` days up to `now`, oldest first (always whole weeks). */
export function weekBuckets(now: Date, days: number): Date[] {
  const last = weekStart(now);
  const first = weekStart(new Date(now.getTime() - (days - 1) * DAY_MS));
  const out: Date[] = [];
  for (let t = first.getTime(); t <= last.getTime(); t += 7 * DAY_MS) out.push(new Date(t));
  return out;
}

/** The first day of the month containing `date`, UTC (billing months). */
export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** The months touched by the last `days` days, oldest first. */
export function monthBuckets(now: Date, days: number): Date[] {
  const first = monthStart(new Date(now.getTime() - (days - 1) * DAY_MS));
  const out: Date[] = [];
  for (let d = first; d.getTime() <= now.getTime(); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))
    out.push(d);
  return out;
}

/** `2026-10` for a billing month (the form's value and the table's key). */
export const monthKey = (date: Date) => date.toISOString().slice(0, 7);

/** A `YYYY-MM` string as the month's first day (UTC), or null. */
export function parseMonthKey(value: string): Date | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : null;
}

// ---------------------------------------------------------------------------------------------
// Percentiles

/**
 * Linear-interpolation percentile (`p` in 0–1) of unsorted values: the same definition as Postgres
 * `percentile_cont`, which the admin page uses over the whole table. This is the reference the
 * tests hold the SQL's numbers against, not something the page computes row by row.
 */
export function percentileCont(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (rank - lo);
}
