import Link from 'next/link';
import { Flag } from 'lucide-react';
import { REPORT_SLA_MS, formatSla, formatShortCode, isUnresolved, type ReportReason } from '@immersia/shared';
import { Button, Card, EmptyState, PageHeader, Pill, buttonClass, cx } from '@immersia/ui';
import { requirePlatformAdmin } from '@/server/admin';
import { adminQueueCounts, adminReports, itemSla, type QueueFilter, type ReportItem } from '@/server/reports';
import { dismissAction, escalateAction, takeDownAction } from '../actions';

const NOTICES: Record<string, { tone: 'ok' | 'bad'; text: string }> = {
  taken_down: {
    tone: 'ok',
    text: 'Taken down: hidden everywhere, files removed from hosted storage. The operator’s own cloud copies were not touched.',
  },
  dismissed: { tone: 'ok', text: 'Report dismissed.' },
  escalated: { tone: 'ok', text: 'Report escalated. It stays in the queue until it is decided.' },
  storage_failed: {
    tone: 'bad',
    text: 'The item is hidden everywhere, but its files could not be removed from storage. Take it down again to retry.',
  },
  not_found: { tone: 'bad', text: 'That report no longer exists.' },
  already_decided: { tone: 'bad', text: 'That report was already decided.' },
  invalid: { tone: 'bad', text: 'That request was not valid.' },
};

const REASON: Record<ReportReason, string> = {
  not_me: 'Did not agree to it',
  inappropriate: 'Inappropriate',
  illegal: 'May be illegal',
  privacy: 'Privacy concern',
  other: 'Other',
};

const TABS: { id: QueueFilter; label: string }[] = [
  { id: 'unresolved', label: 'Needs a decision' },
  { id: 'escalated', label: 'Escalated' },
  { id: 'closed', label: 'Decided' },
];

const when = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function Decide({ item }: { item: ReportItem }) {
  const basis = item.reason === 'illegal' ? 'legal' : 'policy';
  const id = item.id;
  const field = 'focus-ring h-9 w-full rounded-[10px] border border-line-strong bg-elev px-3 text-sm';
  return (
    <div className="mt-4 grid gap-4 border-t border-line pt-4 lg:grid-cols-3">
      <form action={takeDownAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <h3 className="text-sm font-semibold">Take down</h3>
        <label htmlFor={`${id}-basis`} className="block text-[13px] text-muted">
          Reason it comes down
        </label>
        <select id={`${id}-basis`} name="basis" defaultValue={basis} className={field}>
          <option value="policy">Policy or privacy: 410, files deleted</option>
          <option value="legal">Illegal content: 451, files quarantined</option>
        </select>
        <label htmlFor={`${id}-takedown-note`} className="block text-[13px] text-muted">
          Note (optional)
        </label>
        <input id={`${id}-takedown-note`} name="note" maxLength={500} className={field} />
        <Button type="submit" variant="danger" size="sm">
          Take down
        </Button>
      </form>
      <form action={dismissAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <h3 className="text-sm font-semibold">Dismiss</h3>
        <label htmlFor={`${id}-dismiss-note`} className="block text-[13px] text-muted">
          Why nothing is wrong (optional)
        </label>
        <input id={`${id}-dismiss-note`} name="note" maxLength={500} className={field} />
        <Button type="submit" size="sm">
          Dismiss
        </Button>
      </form>
      <form action={escalateAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <h3 className="text-sm font-semibold">Escalate</h3>
        <label htmlFor={`${id}-escalate-note`} className="block text-[13px] text-muted">
          What needs deciding
        </label>
        <input id={`${id}-escalate-note`} name="note" maxLength={500} className={field} />
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="hold" defaultChecked={item.reason === 'illegal'} className="size-4" />
          Hide it meanwhile (files quarantined)
        </label>
        <Button type="submit" size="sm">
          Escalate
        </Button>
      </form>
    </div>
  );
}

function Item({ item, now }: { item: ReportItem; now: Date }) {
  const open = isUnresolved(item.status);
  const sla = itemSla(item, now);
  const overdue = open && sla.overdue;
  return (
    <li
      data-testid="report"
      data-report-id={item.id}
      data-overdue={overdue ? 'true' : 'false'}
      className={cx('card p-5', overdue && 'border-bad/50 bg-bad/[0.04]')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold">{REASON[item.reason]}</span>
        <Pill tone={open ? 'warn' : 'neutral'}>
          {item.status === 'escalated'
            ? 'Escalated'
            : item.status === 'open'
              ? 'Open'
              : item.status === 'actioned'
                ? 'Taken down'
                : 'Dismissed'}
        </Pill>
        {open && (
          <Pill tone={overdue ? 'bad' : sla.remainingMs < 4 * 3_600_000 ? 'warn' : 'neutral'}>
            {overdue ? formatSla(sla.remainingMs) : `24-hour clock: ${formatSla(sla.remainingMs)}`}
          </Pill>
        )}
        {item.system && <Pill tone="info">Automatic scan</Pill>}
        {item.removal && (
          <Pill tone={item.removal === 'operator' ? 'info' : 'bad'}>
            {item.removal === 'operator'
              ? 'Hidden by operator'
              : item.removal === 'legal'
                ? 'Removed (451)'
                : 'Removed (410)'}
          </Pill>
        )}
      </div>
      <p className="mt-2 text-[13px] text-muted">
        {item.eventName} · {item.organizationName} · capture{' '}
        <span className="font-mono">{formatShortCode(item.shortCode)}</span> · filed{' '}
        <time dateTime={item.createdAt.toISOString()}>{when(item.createdAt)}</time>
        {item.removal === null || item.removal === 'operator' ? (
          <>
            {' · '}
            <a href={`/s/${item.linkId}`} target="_blank" rel="noreferrer" className="font-medium text-accent">
              Open the page
            </a>
          </>
        ) : null}
      </p>
      {item.details && <p className="mt-2 max-w-prose text-sm leading-relaxed">“{item.details}”</p>}
      {item.contactEmail && (
        <p className="mt-2 text-[13px] text-muted">
          Reporter would like a reply:{' '}
          <a href={`mailto:${item.contactEmail}`} className="font-medium text-accent">
            {item.contactEmail}
          </a>
        </p>
      )}
      {item.decisionNote && <p className="mt-2 text-[13px] text-muted">Note: {item.decisionNote}</p>}
      {open && <Decide item={item} />}
    </li>
  );
}

type Props = { searchParams: Promise<{ tab?: string; notice?: string }> };

/**
 * The reports queue with its 24-hour clock (PRD risk table: "report link, 24-hour takedown
 * process"). Oldest first, overdue ones in red. Every action is checked against ADMIN_EMAILS on the
 * server and written to the audit log with who did it.
 */
export default async function AdminReportsPage({ searchParams }: Props) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const tab: QueueFilter = TABS.some((t) => t.id === sp.tab) ? (sp.tab as QueueFilter) : 'unresolved';
  const [items, counts] = await Promise.all([adminReports(tab), adminQueueCounts()]);
  const notice = sp.notice ? NOTICES[sp.notice] : undefined;
  const now = new Date();
  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Reports"
        subtitle={`Guests report content from share pages and galleries. Each is answered within ${REPORT_SLA_MS / 3_600_000} hours: take it down, dismiss it, or escalate it. ${counts.unresolved} waiting, ${counts.overdue} overdue.`}
        actions={
          <nav aria-label="Queue" className="flex gap-1">
            {TABS.map((t) => (
              <Link
                key={t.id}
                href={{ pathname: '/admin/reports', query: { tab: t.id } }}
                aria-current={t.id === tab ? 'page' : undefined}
                className={buttonClass({ variant: t.id === tab ? 'primary' : 'secondary', size: 'sm' })}
              >
                {t.label}
                {t.id === 'unresolved' && counts.unresolved > 0 && ` (${counts.unresolved})`}
                {t.id === 'escalated' && counts.escalated > 0 && ` (${counts.escalated})`}
              </Link>
            ))}
          </nav>
        }
      />
      {notice && (
        <p
          role="status"
          className={cx(
            'mb-6 rounded-xl border px-4 py-3 text-sm',
            notice.tone === 'ok' ? 'border-ok/25 bg-ok/[0.07] text-ok' : 'border-bad/30 bg-bad/[0.06] text-bad',
          )}
        >
          {notice.text}
        </p>
      )}
      {items.length === 0 ? (
        <Card pad={false}>
          <EmptyState
            icon={<Flag className="size-5" />}
            title={tab === 'closed' ? 'Nothing decided yet' : 'Nothing waiting'}
            body={
              tab === 'closed'
                ? 'Reports you take down or dismiss appear here.'
                : 'No reports need a decision. New ones are emailed to the admins.'
            }
          />
        </Card>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <Item key={item.id} item={item} now={now} />
          ))}
        </ul>
      )}
    </>
  );
}
