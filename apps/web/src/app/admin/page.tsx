import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  METRIC_TARGETS,
  METRIC_WINDOWS,
  fairUseLevel,
  metricStatus,
  monthBuckets,
  monthKey,
  parseWindow,
  type MetricId,
  type MetricStatus,
} from '@immersia/shared';
import { Button, Card, PageHeader, Pill, Stat, buttonClass, cx } from '@immersia/ui';
import { formatBytes } from '@/lib/format';
import { requirePlatformAdmin } from '@/server/admin';
import { adminMetrics, type TrendPoint } from '@/server/admin-metrics';
import { scannerConfigured, mediaScanner } from '@/server/media-scanner';
import { deleteCostAction, saveCostAction } from './actions';
import { Sparkline } from './Sparkline';

const NOTICES: Record<string, { tone: 'ok' | 'bad'; text: string }> = {
  cost_saved: { tone: 'ok', text: 'The monthly bill was saved.' },
  cost_removed: { tone: 'ok', text: 'The monthly bill was removed.' },
  cost_invalid: { tone: 'bad', text: 'That month or amount is not valid. Use a month and dollars like 1234.56.' },
};

const pct = (v: number | null, digits = 1) => (v === null ? '—' : `${(v * 100).toFixed(digits)}%`);
const secs = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} s`);
const ms = (v: number | null) => (v === null ? '—' : `${Math.round(v).toLocaleString('en')} ms`);
const usd = (v: number | null, digits = 2) => (v === null ? '—' : `$${v.toFixed(digits)}`);

const STATUS: Record<MetricStatus, { tone: 'ok' | 'bad' | 'neutral'; label: string }> = {
  meets: { tone: 'ok', label: 'Meets target' },
  misses: { tone: 'bad', label: 'Misses target' },
  no_data: { tone: 'neutral', label: 'No data yet' },
};

/** One of the six success metrics: its value, target, verdict and weekly trend. */
function MetricCard({
  id,
  title,
  value,
  targetLabel,
  basis,
  trend,
  format,
  scale,
  bucket = 'Week of',
}: {
  id: MetricId;
  title: string;
  value: number | null;
  targetLabel: string;
  /** How it is measured, and the sample behind it. */
  basis: ReactNode;
  trend: TrendPoint[];
  format: (v: number | null) => string;
  scale?: { min?: number; max?: number };
  /** What a trend point is: a week or (for the monthly bill) a month. */
  bucket?: 'Week of' | 'Month';
}) {
  const status = metricStatus(value, METRIC_TARGETS[id]);
  const verdict = STATUS[status];
  return (
    <section aria-labelledby={`m-${id}`} className="card flex flex-col gap-3 p-5" data-metric={id} data-status={status}>
      <div className="flex items-start justify-between gap-3">
        <h2 id={`m-${id}`} className="eyebrow">
          {title}
        </h2>
        <Pill tone={verdict.tone}>{verdict.label}</Pill>
      </div>
      <div className="tabular text-[34px] leading-none font-bold tracking-[-0.03em]" data-testid={`${id}-value`}>
        {format(value)}
      </div>
      <div className="text-[13px] text-muted">Target {targetLabel}</div>
      <Sparkline points={trend} tone={status === 'meets' ? 'ok' : status === 'misses' ? 'bad' : 'ink'} {...scale} />
      <details className="text-[13px]">
        <summary className="focus-ring cursor-pointer rounded text-muted hover:text-fg">
          {bucket === 'Month' ? 'Monthly values' : 'Weekly values'}
        </summary>
        <table className="tabular mt-2 w-full">
          <caption className="sr-only">
            {title}, by {bucket === 'Month' ? 'month' : 'week'}
          </caption>
          <thead className="text-left text-faint">
            <tr>
              <th scope="col" className="py-1 font-medium">
                {bucket}
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Value
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Sample
              </th>
            </tr>
          </thead>
          <tbody>
            {trend.map((p) => (
              <tr key={p.week}>
                <th scope="row" className="py-0.5 text-left font-normal text-muted">
                  {p.week}
                </th>
                <td className="py-0.5 text-right">{format(p.value)}</td>
                <td className="py-0.5 text-right text-muted">{p.n.toLocaleString('en')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="text-[12px] leading-relaxed text-faint">{basis}</p>
    </section>
  );
}

function DataTable({
  caption,
  head,
  children,
  empty,
}: {
  caption: string;
  head: string[];
  children: ReactNode;
  empty?: boolean;
}) {
  if (empty) return <p className="py-6 text-sm text-muted">Nothing recorded in this window yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full min-w-[32rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-left text-[12px] text-faint">
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={cx('py-2 font-medium', i > 0 && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

const Row = ({ cells }: { cells: ReactNode[] }) => (
  <tr>
    {cells.map((c, i) =>
      i === 0 ? (
        <th key={i} scope="row" className="py-2 text-left font-medium">
          {c}
        </th>
      ) : (
        <td key={i} className="py-2 text-right">
          {c}
        </td>
      ),
    )}
  </tr>
);

type Props = { searchParams: Promise<{ window?: string; notice?: string }> };

/**
 * The success metrics (PRD "Success metrics"): the six targets, 30 and 90 day windows, the trend,
 * and the detail behind each (render paths, failures, routes, storage, cost). Platform admins only.
 */
export default async function AdminMetricsPage({ searchParams }: Props) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const windowDays = parseWindow(sp.window);
  const m = await adminMetrics(windowDays);
  const notice = sp.notice ? NOTICES[sp.notice] : undefined;
  const scanner = mediaScanner();
  const months = monthBuckets(m.now, 180).slice(-6).map(monthKey);
  const failureRate =
    m.renderFailures.ok + m.renderFailures.failed > 0
      ? m.renderFailures.failed / (m.renderFailures.ok + m.renderFailures.failed)
      : null;

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Success metrics"
        subtitle={`The last ${windowDays} days, to ${m.now.toISOString().slice(0, 16).replace('T', ' ')} UTC. Each figure is the PRD's definition; the weekly trend sits under it.`}
        actions={
          <nav aria-label="Window" className="flex gap-1">
            {METRIC_WINDOWS.map((d) => (
              <Link
                key={d}
                href={{ pathname: '/admin', query: { window: d } }}
                aria-current={d === windowDays ? 'page' : undefined}
                className={buttonClass({ variant: d === windowDays ? 'primary' : 'secondary', size: 'sm' })}
              >
                {d} days
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          id="captureToQr"
          title="Capture-to-QR, p90"
          value={m.captureToQr.p90}
          targetLabel="60 s or less (15 s 360 clip, 1080p, 2022+ laptop)"
          format={secs}
          trend={m.captureToQr.trend}
          basis={`Seconds from the end of a take to its QR code on screen. p50 ${secs(m.captureToQr.p50)}. ${m.captureToQr.n.toLocaleString('en')} QR codes.`}
        />
        <MetricCard
          id="crashFreeEvents"
          title="Events without a crash"
          value={m.crashFree.value}
          targetLabel="99% or more"
          format={(v) => pct(v)}
          scale={{ min: 0.9, max: 1 }}
          trend={m.crashFree.trend}
          basis={`${m.crashFree.whole.toLocaleString('en')} events with a booth running, ${m.crashFree.crashed.toLocaleString('en')} with a crash report. ${m.crashFree.unclean.toLocaleString('en')} of ${m.crashFree.sessions.toLocaleString('en')} sessions ended with no sign off or crash report in 12 hours (shown, not counted as crashes).`}
        />
        <MetricCard
          id="downloadSuccess"
          title="Guest download success"
          value={m.downloadSuccess.value}
          targetLabel="97% or more"
          format={(v) => pct(v)}
          scale={{ min: 0.8, max: 1 }}
          trend={m.downloadSuccess.trend}
          basis={`Of ${m.downloadSuccess.whole.toLocaleString('en')} guest sessions whose share page loaded (link-preview robots excluded), ${m.downloadSuccess.part.toLocaleString('en')} downloaded a file.`}
        />
        <MetricCard
          id="multiEventOperators"
          title="Operators running 2+ events"
          value={m.multiEvent.value}
          targetLabel="35% or more of activated operators"
          format={(v) => pct(v)}
          trend={m.multiEvent.trend}
          basis={`${m.multiEvent.part.toLocaleString('en')} of ${m.multiEvent.whole.toLocaleString('en')} activated operators (an organization that has captured at least one session), to date.`}
        />
        <MetricCard
          id="devicesPerOperator"
          title="Devices per active operator"
          value={m.devicesPerOperator.value}
          targetLabel="1.5 or more"
          format={(v) => (v === null ? '—' : v.toFixed(2))}
          trend={m.devicesPerOperator.trend}
          basis={`${m.devicesPerOperator.devices.toLocaleString('en')} devices that captured sessions across ${m.devicesPerOperator.operators.toLocaleString('en')} active operators.`}
        />
        <MetricCard
          id="costPerOperator"
          title="Infrastructure cost per active operator"
          value={m.cost.latest?.perOperator ?? null}
          targetLabel="$0.40 or less per month"
          format={(v) => usd(v)}
          scale={{ min: 0 }}
          bucket="Month"
          trend={m.cost.months.map((c) => ({ week: c.month, value: c.perOperator, n: c.operators }))}
          basis={
            m.cost.latest
              ? `${m.cost.latest.month}: ${usd(m.cost.latest.billCents / 100)} bill over ${m.cost.latest.operators.toLocaleString('en')} monthly active operators. Enter bills below.`
              : 'Enter a monthly cloud bill below to measure this.'
          }
        />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Active operators"
          value={m.devicesPerOperator.operators.toLocaleString('en')}
          hint={`Captured a session in ${windowDays} days`}
        />
        <Stat
          label="Events run"
          value={m.devicesPerOperator.events.toLocaleString('en')}
          hint="With at least one session"
        />
        <Stat
          label="Devices used"
          value={m.devicesPerOperator.devices.toLocaleString('en')}
          hint="Captured a session"
        />
      </div>

      <div className="mt-8 space-y-6">
        <Card
          title="Capture-to-QR by render path"
          subtitle="Where the time goes: how long after a take ended its files were rendered (queue wait included), and the render alone."
        >
          <DataTable
            caption="Render timings by path"
            head={['Path', 'Renders', 'Ready p50', 'Ready p90', 'Render p50', 'Render p90']}
            empty={m.byPath.length === 0}
          >
            {m.byPath.map((p) => (
              <Row
                key={p.path}
                cells={[
                  p.path,
                  p.n.toLocaleString('en'),
                  secs(p.readyP50),
                  secs(p.readyP90),
                  ms(p.renderP50),
                  ms(p.renderP90),
                ]}
              />
            ))}
          </DataTable>
        </Card>

        <Card
          title="Render failures"
          subtitle={`${m.renderFailures.failed.toLocaleString('en')} of ${(m.renderFailures.ok + m.renderFailures.failed).toLocaleString('en')} renders failed (${pct(failureRate)}), by error code and browser.`}
        >
          <DataTable
            caption="Render failures by error code and browser"
            head={['Error code', 'Browser', 'Failures']}
            empty={m.renderFailures.byCause.length === 0}
          >
            {m.renderFailures.byCause.map((f) => (
              <Row key={`${f.code}/${f.browser}`} cells={[f.code, f.browser, f.count.toLocaleString('en')]} />
            ))}
          </DataTable>
        </Card>

        <Card
          title="Download success by route"
          subtitle="Of the guest sessions opened through each route, how many downloaded a file."
        >
          <DataTable
            caption="Download success by route"
            head={['Route', 'Sessions viewed', 'Downloaded', 'Success']}
            empty={m.downloadSuccess.byRoute.length === 0}
          >
            {m.downloadSuccess.byRoute.map((r) => (
              <Row
                key={r.route}
                cells={[r.route, r.whole.toLocaleString('en'), r.part.toLocaleString('en'), pct(r.value)]}
              />
            ))}
          </DataTable>
        </Card>

        <Card
          title="Storage per organization"
          subtitle={`${formatBytes(m.storage.totalBytes, 'en')} stored in all. Fair use is 50 GB per organization: ${m.storage.near} near it, ${m.storage.over} over.`}
        >
          <DataTable
            caption="Stored files per organization against the 50 GB fair-use ceiling"
            head={['Organization', 'Guest files', 'Library', 'Total', 'Of 50 GB']}
            empty={m.storage.organizations.length === 0}
          >
            {m.storage.organizations.slice(0, 25).map((o) => (
              <Row
                key={o.id}
                cells={[
                  o.name,
                  formatBytes(o.guestBytes, 'en'),
                  formatBytes(o.assetBytes, 'en'),
                  formatBytes(o.bytes, 'en'),
                  <span key="s" className="inline-flex items-center gap-2">
                    {pct(o.share, 0)}
                    <Pill
                      tone={
                        fairUseLevel(o.share) === 'over' ? 'bad' : fairUseLevel(o.share) === 'near' ? 'warn' : 'neutral'
                      }
                    >
                      {fairUseLevel(o.share) === 'over' ? 'Over' : fairUseLevel(o.share) === 'near' ? 'Near' : 'Within'}
                    </Pill>
                  </span>,
                ]}
              />
            ))}
          </DataTable>
        </Card>

        <Card
          id="cost"
          title="Infrastructure cost"
          subtitle="Enter each month's cloud bill (all providers, in US dollars). Cost per active operator is the bill divided by the organizations that captured a session that month."
        >
          <DataTable
            caption="Monthly cloud bill and cost per active operator"
            head={['Month', 'Bill', 'Active operators', 'Per operator', 'Actions']}
          >
            {m.cost.months.map((c) => (
              <Row
                key={c.month}
                cells={[
                  c.month,
                  c.billCents === null ? '—' : usd(c.billCents / 100),
                  c.operators.toLocaleString('en'),
                  usd(c.perOperator),
                  c.billCents === null ? null : (
                    <form key="d" action={deleteCostAction}>
                      <input type="hidden" name="month" value={c.month} />
                      <Button type="submit" size="sm" variant="ghost" aria-label={`Remove the bill for ${c.month}`}>
                        Remove
                      </Button>
                    </form>
                  ),
                ]}
              />
            ))}
          </DataTable>
          <form action={saveCostAction} className="flex flex-wrap items-end gap-3 border-t border-line py-4">
            <label className="text-sm font-medium">
              <span className="block pb-1.5">Month</span>
              <select
                name="month"
                defaultValue={monthKey(m.now)}
                className="focus-ring h-9 rounded-[10px] border border-line-strong bg-elev px-3 text-sm"
              >
                {months.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              <span className="block pb-1.5">Bill (USD)</span>
              <input
                name="amount"
                inputMode="decimal"
                required
                pattern="\d{1,9}(\.\d{1,2})?"
                placeholder="1234.56"
                className="focus-ring h-9 w-36 rounded-[10px] border border-line-strong bg-elev px-3 text-sm"
              />
            </label>
            <label className="min-w-48 flex-1 text-sm font-medium">
              <span className="block pb-1.5">Note (optional)</span>
              <input
                name="note"
                maxLength={500}
                className="focus-ring h-9 w-full rounded-[10px] border border-line-strong bg-elev px-3 text-sm"
              />
            </label>
            <Button type="submit" variant="primary">
              Save bill
            </Button>
          </form>
        </Card>

        <Card title="Hash matching" subtitle="Known-illegal-content scanning of hosted media.">
          <p className="py-3 text-sm leading-relaxed text-muted">
            {scannerConfigured()
              ? `Uploads are checked by the "${scanner.name}" scanner as they complete; a match takes the session down as illegal and opens a report.`
              : 'No media scanner is connected, so uploads are not hash-matched. Cloudflare’s CSAM Scanning Tool covers images served through its cache only; video needs a vendor and a legal decision (see SECURITY.md).'}
          </p>
        </Card>
      </div>
    </>
  );
}
