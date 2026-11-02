/** Locale-aware formatting shared by server and client components. */

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

export function formatBytes(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0)
    return new Intl.NumberFormat(locale, { style: 'unit', unit: 'byte', unitDisplay: 'long' }).format(0);
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1000)));
  const value = bytes / 1000 ** i;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: UNITS[i],
    unitDisplay: i === 0 ? 'long' : 'short',
    maximumFractionDigits: value < 10 && i > 0 ? 1 : 0,
  }).format(value);
}

/** A running time, as a player shows it: 0:07, 3:21, 1:02:03. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A length of time in words, for limits: 30 seconds, 15 minutes. */
export function formatSpan(ms: number, locale: string): string {
  const whole = ms >= 60_000 && ms % 60_000 === 0;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: whole ? 'minute' : 'second',
    unitDisplay: 'long',
  }).format(whole ? ms / 60_000 : ms / 1000);
}

/** An event date (YYYY-MM-DD, no time zone) — formatted without shifting across midnight. */
export function formatEventDate(isoDate: string, locale: string, style: 'medium' | 'long' = 'medium'): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

const DIVISIONS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, 'second'],
  [60, 'minute'],
  [24, 'hour'],
  [7, 'day'],
  [4.34524, 'week'],
  [12, 'month'],
  [Number.POSITIVE_INFINITY, 'year'],
];

export function formatRelative(date: Date, locale: string, now = Date.now()): string {
  let duration = (date.getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [amount, unit] of DIVISIONS) {
    if (Math.abs(duration) < amount) return rtf.format(Math.round(duration), unit);
    duration /= amount;
  }
  return rtf.format(Math.round(duration), 'year');
}

/** Today in the operator's time zone as YYYY-MM-DD (for date inputs and new events). */
export function todayIso(timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}
