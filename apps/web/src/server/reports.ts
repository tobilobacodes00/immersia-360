import 'server-only';
import { and, asc, count, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { DEFAULT_LOCALE } from '@immersia/i18n';
import {
  normalizeShortCode,
  UNRESOLVED_STATUSES,
  slaClock,
  uuidv7,
  type RemovalBasis,
  type ReportInput,
  type ReportReason,
  type ReportStatus,
} from '@immersia/shared';
import { audit } from './audit';
import { adminEmails } from './admin';
import { sendReportAdminEmail, sendReportEscalationEmail, sendReportOperatorEmail } from './email';
import { appOrigin, env } from './env';
import { allow } from './rate-limit';
import { removalOf, stateOf } from './share-state';
import { takeDownSession } from './takedown';

const { report, captureSession, event, organization, member, user } = schema;

/**
 * Abuse reports (PRD Abuse NFR; risk table: "report link, 24-hour takedown process").
 *
 * A guest reports a session from its share page or the event gallery. The report records why and,
 * if the guest chose, how to reply; who reported is known only as a salted hash that changes daily
 * (enough to rate-limit one reporter, not enough to identify or link them). The event's operator
 * and the platform admins are told, the operator can hide the item at once, and the platform has
 * 24 hours to take it down, dismiss the report or escalate it.
 */

// -----------------------------------------------------------------------------------------------
// What a guest can report

export interface ReportTarget {
  sessionId: string;
  linkId: string;
  eventId: string;
  organizationId: string;
  eventName: string;
  theme: { accent: string; background: string; ink: string; font: 'sans' | 'serif' };
  /** Why it is hidden or taken down, when it is. */
  removal: RemovalBasis | null;
  /**
   * Erased by its guest, hidden or taken down: there is nothing left to report (the session-state
   * model in share-state.ts; an expired session can still be reported, it is only no longer served).
   */
  gone: boolean;
}

const targetColumns = {
  sessionId: captureSession.id,
  linkId: captureSession.linkId,
  eventId: event.id,
  organizationId: event.organizationId,
  eventName: event.name,
  branding: event.branding,
  removal: captureSession.removal,
  removedAt: captureSession.removedAt,
  erasedAt: captureSession.erasedAt,
  expiresAt: captureSession.expiresAt,
  expiredAt: captureSession.expiredAt,
};

function toTarget(row: {
  sessionId: string;
  linkId: string;
  eventId: string;
  organizationId: string;
  eventName: string;
  branding: { theme: ReportTarget['theme'] };
  removal: RemovalBasis | null;
  removedAt: Date | null;
  erasedAt: Date | null;
  expiresAt: Date;
  expiredAt: Date | null;
}): ReportTarget {
  const state = stateOf({ ...row, ready: 0 });
  return {
    sessionId: row.sessionId,
    linkId: row.linkId,
    eventId: row.eventId,
    organizationId: row.organizationId,
    eventName: row.eventName,
    theme: row.branding.theme,
    removal: removalOf(row),
    gone: state === 'erased' || state === 'hidden' || state === 'removed',
  };
}

/** The session a share page's link id names: the page's "Report this" link. */
export async function reportTargetForLink(linkId: string): Promise<ReportTarget | null> {
  const [row] = await db()
    .select(targetColumns)
    .from(captureSession)
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(eq(captureSession.linkId, linkId))
    .limit(1);
  return row ? toTarget(row) : null;
}

/** The session with this short code in the event gallery `slug`: the gallery's report form asks for the code. */
export async function reportTargetForGallery(slug: string, rawCode: string): Promise<ReportTarget | null> {
  const code = normalizeShortCode(rawCode);
  if (!code || !/^[A-Za-z0-9_-]{8,40}$/.test(slug)) return null;
  const [row] = await db()
    .select(targetColumns)
    .from(captureSession)
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(and(eq(event.gallerySlug, slug), eq(captureSession.shortCode, code)))
    .limit(1);
  return row ? toTarget(row) : null;
}

// -----------------------------------------------------------------------------------------------
// Filing a report

export type CreateReportResult =
  { status: 'created'; reportId: string } | { status: 'duplicate' } | { status: 'too_many' } | { status: 'removed' };

/**
 * Store a report. Limited per reporter (a salted daily hash, five a day), per session and per event,
 * so the form can't be used to bury an operator; the same reporter reporting the same session again
 * within a day is acknowledged without a second row.
 */
export async function createReport(
  target: ReportTarget,
  input: ReportInput,
  reporter: string,
): Promise<CreateReportResult> {
  if (target.gone) return { status: 'removed' };
  const [dupe] = await db()
    .select({ id: report.id })
    .from(report)
    .where(
      and(
        eq(report.sessionId, target.sessionId),
        eq(report.reporterHash, reporter),
        gt(report.createdAt, new Date(Date.now() - 86_400_000)),
      ),
    )
    .limit(1);
  if (dupe) return { status: 'duplicate' };
  if (
    !(await allow('reportPerReporter', reporter)) ||
    !(await allow('reportPerSession', target.sessionId)) ||
    !(await allow('reportPerEvent', target.eventId))
  )
    return { status: 'too_many' };
  const id = uuidv7();
  await db().insert(report).values({
    id,
    sessionId: target.sessionId,
    reason: input.reason,
    details: input.details,
    contactEmail: input.contact,
    reporterHash: reporter,
  });
  return { status: 'created', reportId: id };
}

// -----------------------------------------------------------------------------------------------
// Telling people

const REASON_LABEL: Record<ReportReason, string> = {
  not_me: "it shows someone who didn't agree to it",
  inappropriate: 'it is inappropriate',
  illegal: 'it may be illegal',
  privacy: 'it is a privacy concern',
  other: 'another reason',
};

/**
 * After a report is filed: email the event's operator (its owners and whoever created the event) and
 * the platform admins. One email per session per hour (the operator's badge and the admin queue
 * count every report), except that an `illegal` report always reaches the admins. Never throws: a
 * mail failure must not undo a report.
 */
export async function notifyNewReport(reportId: string, opts: { auto?: string } = {}): Promise<void> {
  try {
    const [row] = await db()
      .select({
        reason: report.reason,
        sessionId: report.sessionId,
        createdAt: report.createdAt,
        eventId: event.id,
        eventName: event.name,
        organizationId: event.organizationId,
        organizationName: organization.name,
        createdBy: event.createdBy,
      })
      .from(report)
      .innerJoin(captureSession, eq(captureSession.id, report.sessionId))
      .innerJoin(event, eq(event.id, captureSession.eventId))
      .innerJoin(organization, eq(organization.id, event.organizationId))
      .where(eq(report.id, reportId))
      .limit(1);
    if (!row) return;
    const [{ recent } = { recent: 0 }] = await db()
      .select({ recent: count() })
      .from(report)
      .where(
        and(eq(report.sessionId, row.sessionId), gt(report.createdAt, new Date(row.createdAt.getTime() - 3_600_000))),
      );
    const first = recent <= 1;
    const reason = REASON_LABEL[row.reason];

    if (first) {
      const people = await db()
        .select({ email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(
          and(
            eq(member.organizationId, row.organizationId),
            row.createdBy ? or(eq(member.role, 'owner'), eq(member.userId, row.createdBy)) : eq(member.role, 'owner'),
          ),
        );
      const url = `${appOrigin()}/studio/events/${row.eventId}`;
      for (const email of new Set(people.map((p) => p.email)))
        await sendReportOperatorEmail(email, url, DEFAULT_LOCALE, { event: row.eventName, reason: row.reason }).catch(
          mailFailed,
        );
    }
    if (first || row.reason === 'illegal') {
      const url = `${appOrigin()}/admin/reports`;
      for (const email of adminEmails())
        await sendReportAdminEmail(email, url, {
          event: row.eventName,
          organization: row.organizationName,
          reason,
          auto: opts.auto,
        }).catch(mailFailed);
    }
  } catch (err) {
    mailFailed(err);
  }
}

const mailFailed = (err: unknown) =>
  console.error('[reports] notification failed', err instanceof Error ? err.name : err);

// -----------------------------------------------------------------------------------------------
// Listing reports

export interface ReportItem {
  id: string;
  sessionId: string;
  eventId: string;
  eventName: string;
  organizationId: string;
  organizationName: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  decisionNote: string | null;
  createdAt: Date;
  actionedAt: Date | null;
  shortCode: string;
  linkId: string;
  removal: RemovalBasis | null;
  /** Raised by an automatic scan, not a person. */
  system: boolean;
  /** Only for admins: how to reply to the reporter, if they said. */
  contactEmail: string | null;
}

const itemQuery = () =>
  db()
    .select({
      id: report.id,
      sessionId: report.sessionId,
      eventId: event.id,
      eventName: event.name,
      organizationId: event.organizationId,
      organizationName: organization.name,
      reason: report.reason,
      details: report.details,
      status: report.status,
      decisionNote: report.decisionNote,
      createdAt: report.createdAt,
      actionedAt: report.actionedAt,
      shortCode: captureSession.shortCode,
      linkId: captureSession.linkId,
      removal: captureSession.removal,
      removedAt: captureSession.removedAt,
      reporterHash: report.reporterHash,
      contactEmail: report.contactEmail,
    })
    .from(report)
    .innerJoin(captureSession, eq(captureSession.id, report.sessionId))
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .innerJoin(organization, eq(organization.id, event.organizationId));

type ItemRow = Awaited<ReturnType<typeof itemQuery>>[number];

function toItem(r: ItemRow, withContact: boolean): ReportItem {
  const { removedAt, reporterHash, contactEmail, ...rest } = r;
  return {
    ...rest,
    removal: removedAt ? (rest.removal ?? 'policy') : null,
    system: reporterHash === null,
    contactEmail: withContact ? contactEmail : null,
  };
}

/** An organization's reports (all of its events, or one), unresolved first. Never includes a reporter's contact. */
export async function reportsForOrganization(
  organizationId: string,
  opts: { eventId?: string; limit?: number } = {},
): Promise<ReportItem[]> {
  const rows = await itemQuery()
    .where(and(eq(event.organizationId, organizationId), opts.eventId ? eq(event.id, opts.eventId) : undefined))
    .orderBy(sql`(${report.status} in ('open', 'escalated')) desc`, desc(report.createdAt))
    .limit(opts.limit ?? 100);
  return rows.map((r) => toItem(r, false));
}

/** Reports waiting for a decision on an organization's events: the studio's badge. */
export async function openReportCount(organizationId: string): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(report)
    .innerJoin(captureSession, eq(captureSession.id, report.sessionId))
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .where(and(eq(event.organizationId, organizationId), inArray(report.status, [...UNRESOLVED_STATUSES])));
  return row?.n ?? 0;
}

export type QueueFilter = 'unresolved' | 'escalated' | 'closed';

/** The admin queue. Unresolved: oldest first (the one nearest its deadline on top). Closed: newest first. */
export async function adminReports(filter: QueueFilter, limit = 200): Promise<ReportItem[]> {
  const where =
    filter === 'closed'
      ? inArray(report.status, ['actioned', 'dismissed'])
      : filter === 'escalated'
        ? eq(report.status, 'escalated')
        : inArray(report.status, [...UNRESOLVED_STATUSES]);
  const rows = await itemQuery()
    .where(where)
    .orderBy(filter === 'closed' ? desc(report.actionedAt) : asc(report.createdAt))
    .limit(limit);
  return rows.map((r) => toItem(r, true));
}

/** Counts for the queue's tabs and the 24-hour clock: how many wait, and how many are past their deadline. */
export async function adminQueueCounts(): Promise<{ unresolved: number; escalated: number; overdue: number }> {
  const [row] = await db()
    .select({
      unresolved: count(),
      escalated: sql<number>`count(*) filter (where ${report.status} = 'escalated')`.mapWith(Number),
      overdue: sql<number>`count(*) filter (where ${report.createdAt} < now() - interval '24 hours')`.mapWith(Number),
    })
    .from(report)
    .where(inArray(report.status, [...UNRESOLVED_STATUSES]));
  return { unresolved: row?.unresolved ?? 0, escalated: row?.escalated ?? 0, overdue: row?.overdue ?? 0 };
}

export const itemSla = (item: Pick<ReportItem, 'createdAt'>, now = new Date()) => slaClock(item.createdAt, now);

// -----------------------------------------------------------------------------------------------
// Decisions (platform admins)

export type DecisionResult = { ok: true } | { ok: false; error: 'not_found' | 'already_decided' | 'storage_failed' };

async function findReport(reportId: string) {
  const [row] = await db()
    .select({
      id: report.id,
      sessionId: report.sessionId,
      status: report.status,
      reason: report.reason,
      organizationId: event.organizationId,
      eventName: event.name,
      organizationName: organization.name,
    })
    .from(report)
    .innerJoin(captureSession, eq(captureSession.id, report.sessionId))
    .innerJoin(event, eq(event.id, captureSession.eventId))
    .innerJoin(organization, eq(organization.id, event.organizationId))
    .where(eq(report.id, reportId))
    .limit(1);
  return row;
}

/**
 * Take the reported session down, for every report against it (they are all about the same
 * content). `legal` answers 451 and quarantines the files; `policy` answers 410 and deletes them.
 * If the files can't be removed the session is already hidden, the report stays open, and doing it
 * again finishes the job.
 */
export async function takeDownReport(
  actorUserId: string,
  reportId: string,
  basis: Exclude<RemovalBasis, 'operator'>,
  note: string | null,
): Promise<DecisionResult> {
  const r = await findReport(reportId);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status === 'actioned' || r.status === 'dismissed') return { ok: false, error: 'already_decided' };
  const result = await takeDownSession({
    sessionId: r.sessionId,
    basis,
    actorUserId,
    auditAction: 'report.takedown',
    meta: { reportId, reason: r.reason, note },
  });
  if (!result.ok) return { ok: false, error: result.error };
  await closeReports(r.sessionId, actorUserId, note);
  return { ok: true };
}

export async function dismissReport(
  actorUserId: string,
  reportId: string,
  note: string | null,
): Promise<DecisionResult> {
  const r = await findReport(reportId);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status === 'actioned' || r.status === 'dismissed') return { ok: false, error: 'already_decided' };
  await db().transaction(async (tx) => {
    await tx
      .update(report)
      .set({
        status: 'dismissed',
        actionedAt: new Date(),
        actionedBy: actorUserId,
        decisionNote: note,
        contactEmail: null,
      })
      .where(eq(report.id, reportId));
    await audit(
      {
        organizationId: r.organizationId,
        actorUserId,
        action: 'report.dismiss',
        target: `report:${reportId}`,
        meta: { note },
      },
      tx,
    );
  });
  return { ok: true };
}

/**
 * Pass a report up for a legal or trust decision. It stays unresolved (the 24-hour clock keeps
 * running); the escalation address (TRUST_EMAIL) is told. With `hold`, the item is taken out of
 * service meanwhile, as illegal content would be: hidden everywhere, files quarantined, not destroyed.
 */
export async function escalateReport(
  actorUserId: string,
  reportId: string,
  note: string | null,
  hold: boolean,
): Promise<DecisionResult> {
  const r = await findReport(reportId);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status === 'actioned' || r.status === 'dismissed') return { ok: false, error: 'already_decided' };
  if (hold) {
    const held = await takeDownSession({
      sessionId: r.sessionId,
      basis: 'legal',
      actorUserId,
      auditAction: 'report.escalate_hold',
      meta: { reportId, reason: r.reason, note },
    });
    if (!held.ok) return { ok: false, error: held.error };
  }
  await db().transaction(async (tx) => {
    await tx
      .update(report)
      .set({ status: 'escalated', decisionNote: note, actionedBy: actorUserId })
      .where(eq(report.id, reportId));
    await audit(
      {
        organizationId: r.organizationId,
        actorUserId,
        action: 'report.escalate',
        target: `report:${reportId}`,
        meta: { note, hold },
      },
      tx,
    );
  });
  const to = env().TRUST_EMAIL;
  if (to)
    await sendReportEscalationEmail(to, `${appOrigin()}/admin/reports`, {
      event: r.eventName,
      organization: r.organizationName,
      reason: REASON_LABEL[r.reason],
      note: note ?? '',
    }).catch(mailFailed);
  return { ok: true };
}

/** Close every unresolved report on a session (a takedown decides them all) and drop the reporters' contacts. */
async function closeReports(sessionId: string, actorUserId: string, note: string | null) {
  await db()
    .update(report)
    .set({
      status: 'actioned',
      actionedAt: new Date(),
      actionedBy: actorUserId,
      decisionNote: note,
      contactEmail: null,
    })
    .where(and(eq(report.sessionId, sessionId), inArray(report.status, [...UNRESOLVED_STATUSES])));
}

// -----------------------------------------------------------------------------------------------
// Automatic scan (see media-scanner.ts)

/**
 * A media scanner matched an upload against known illegal content: take the session down as illegal
 * (451, files quarantined) and open a report so the match is in the admin queue with the audit trail.
 */
export async function flagSession(input: { sessionId: string; scanner: string; detail: string }): Promise<void> {
  const [exists] = await db()
    .select({ id: captureSession.id, removedAt: captureSession.removedAt })
    .from(captureSession)
    .where(eq(captureSession.id, input.sessionId))
    .limit(1);
  if (!exists) return;
  const id = uuidv7();
  await db()
    .insert(report)
    .values({
      id,
      sessionId: input.sessionId,
      reason: 'illegal',
      details: `Flagged automatically by ${input.scanner}: ${input.detail}`.slice(0, 1000),
      reporterHash: null,
    });
  await takeDownSession({
    sessionId: input.sessionId,
    basis: 'legal',
    actorUserId: null,
    auditAction: 'scan.flagged',
    meta: { reportId: id, scanner: input.scanner },
  });
  await notifyNewReport(id, { auto: `An automatic scan (${input.scanner}) flagged content` });
}
