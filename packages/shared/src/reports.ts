/**
 * Reports and takedowns (PRD Abuse NFR: report-content link on share pages, 24-hour takedown
 * process). The rules every layer agrees on: why someone can report, how long the platform has to
 * act, what a removed page answers, and how a reporter is told apart for rate limiting without
 * being identified.
 */
import { z } from 'zod';
import { hmac } from './live';

/** Mirrors the `report_reason` enum in the database. */
export const REPORT_REASONS = ['not_me', 'inappropriate', 'illegal', 'privacy', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Mirrors `report_status`. `escalated` is still open work: passed up for a decision. */
export const REPORT_STATUSES = ['open', 'escalated', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
/** Statuses that still need a decision (and still run the SLA clock). */
export const UNRESOLVED_STATUSES = ['open', 'escalated'] as const satisfies readonly ReportStatus[];
export const isUnresolved = (status: ReportStatus) => (UNRESOLVED_STATUSES as readonly string[]).includes(status);

/**
 * Why a guest session is no longer served, as stored on it:
 * - `operator`: the event's operator hid it. Reversible by them; the files are untouched.
 * - `policy`: the platform took it down (a policy violation, a privacy complaint…). Files are deleted.
 * - `legal`: taken down as illegal. Answers 451, and the files are quarantined rather than deleted,
 *   so they can be handed to the authorities if the law requires it.
 */
export const REMOVAL_BASES = ['operator', 'policy', 'legal'] as const;
export type RemovalBasis = (typeof REMOVAL_BASES)[number];

/** The HTTP status a removed session answers: 451 Unavailable For Legal Reasons for illegal content, else 410 Gone. */
export const removalHttpStatus = (basis: RemovalBasis): 451 | 410 => (basis === 'legal' ? 451 : 410);

/** What the platform commits to: act on a report within 24 hours. */
export const REPORT_SLA_MS = 24 * 3_600_000;

export interface SlaClock {
  dueAt: Date;
  /** Negative once overdue. */
  remainingMs: number;
  overdue: boolean;
}

export function slaClock(createdAt: Date, now: Date = new Date()): SlaClock {
  const dueAt = new Date(createdAt.getTime() + REPORT_SLA_MS);
  const remainingMs = dueAt.getTime() - now.getTime();
  return { dueAt, remainingMs, overdue: remainingMs < 0 };
}

/** "3h 12m left" / "2h 5m overdue", English, for the admin queue. */
export function formatSla(remainingMs: number): string {
  const abs = Math.abs(remainingMs);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const span = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return remainingMs < 0 ? `${span} overdue` : `${span} left`;
}

// ---------------------------------------------------------------------------------------------
// The guest's form

export const REPORT_DETAILS_MAX = 1000;

/** What the report form posts. The contact address is optional and only ever used to reply. */
export const reportInputSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  details: z
    .string()
    .trim()
    .max(REPORT_DETAILS_MAX)
    .transform((v) => (v === '' ? null : v)),
  contact: z
    .string()
    .trim()
    .max(254)
    .transform((v) => (v === '' ? null : v))
    .pipe(z.email().nullable()),
});
export type ReportInput = z.infer<typeof reportInputSchema>;

// ---------------------------------------------------------------------------------------------
// The reporter, without identifying them

/** `2026-10-19`, UTC: the day a reporter hash is valid for. */
export const reporterDay = (now: Date = new Date()) => now.toISOString().slice(0, 10);

/**
 * A pseudonym for rate limiting: HMAC of the network address under a salt that is itself derived
 * from the server secret and today's date. Within a day one address always maps to the same value
 * (so repeat reports and floods are limited); tomorrow it maps to a different one (so reports can't
 * be linked across days), and without the server secret the value can't be turned back into an
 * address by trying all of them. The address is not stored anywhere.
 */
export async function reporterHash(address: string, secret: string, now: Date = new Date()): Promise<string> {
  const salt = await hmac(secret, `reporter-salt:${reporterDay(now)}`);
  return (await hmac(salt, address)).slice(0, 32);
}
