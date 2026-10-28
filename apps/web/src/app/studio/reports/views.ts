import { formatRelative } from '@/lib/format';
import type { ReportItem } from '@/server/reports';
import type { ReportView } from './ReportList';

/** A report for the operator's screens: the reporter's contact is never part of it. */
export function toReportView(item: ReportItem, locale: string): ReportView {
  return {
    id: item.id,
    sessionId: item.sessionId,
    eventId: item.eventId,
    eventName: item.eventName,
    reason: item.reason,
    details: item.details,
    status: item.status,
    when: formatRelative(item.createdAt, locale),
    shortCode: item.shortCode,
    linkId: item.linkId,
    removal: item.removal,
  };
}
