import 'server-only';
import { eq, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import {
  costPerOperator,
  fairUseLevel,
  fairUseShare,
  monthBuckets,
  monthKey,
  monthStart,
  ratio,
  weekBuckets,
  type FairUseLevel,
  type MetricWindow,
} from '@immersia/shared';
import { audit } from './audit';

/**
 * The success metrics (PRD "Success metrics"), read from the database. Everything heavy happens in
 * SQL: percentile_cont over the window, date_trunc for the weekly trend, one grouped query per
 * measure. Events are read through (name, occurred_at), the index each monthly partition of
 * analytics_event carries; the measures that are really facts about the business (operators, events,
 * devices, storage) come from the tables that hold those facts, not from events that could be lost.
 */

export interface TrendPoint {
  /** Monday of the week, `YYYY-MM-DD`. */
  week: string;
  value: number | null;
  /** The sample behind the value. */
  n: number;
}

export interface QrTiming {
  p50: number | null;
  p90: number | null;
  n: number;
  trend: TrendPoint[];
}

export interface PathTiming {
  path: string;
  n: number;
  /** Seconds from the end of the take until the files were rendered. */
  readyP50: number | null;
  readyP90: number | null;
  /** Milliseconds the render itself took. */
  renderP50: number | null;
  renderP90: number | null;
}

export interface Share {
  part: number;
  whole: number;
  value: number | null;
}

export interface AdminMetrics {
  windowDays: MetricWindow;
  since: Date;
  now: Date;
  captureToQr: QrTiming;
  byPath: PathTiming[];
  renderFailures: { ok: number; failed: number; byCause: { code: string; browser: string; count: number }[] };
  crashFree: Share & { crashed: number; unclean: number; sessions: number; trend: TrendPoint[] };
  downloadSuccess: Share & { byRoute: (Share & { route: string })[]; trend: TrendPoint[] };
  multiEvent: Share & { trend: TrendPoint[] };
  devicesPerOperator: { operators: number; devices: number; events: number; value: number | null; trend: TrendPoint[] };
  cost: {
    months: {
      month: string;
      billCents: number | null;
      operators: number;
      perOperator: number | null;
      note: string | null;
    }[];
    /** The latest month that has a bill. */
    latest: { month: string; billCents: number; operators: number; perOperator: number | null } | null;
  };
  storage: {
    totalBytes: number;
    organizations: {
      id: string;
      name: string;
      guestBytes: number;
      assetBytes: number;
      bytes: number;
      share: number;
      level: FairUseLevel;
    }[];
    near: number;
    over: number;
  };
}

// The driver widens the row type to its own QueryResultRow shape; let it, and read the columns back
// as the caller declared them.
const rows = async <T extends Record<string, unknown>>(query: SQL): Promise<T[]> =>
  (await db().execute<T>(query)).rows as T[];
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Weekly points for the window's weeks: the value and sample per week, `null` where nothing happened. */
function trendOf<R extends { week: string | null }>(
  data: R[],
  weeks: Date[],
  pick: (r: R) => { value: number | null; n: number },
): TrendPoint[] {
  const byWeek = new Map<string, R>();
  for (const r of data) if (r.week) byWeek.set(r.week, r);
  return weeks.map((w) => {
    const week = w.toISOString().slice(0, 10);
    const r = byWeek.get(week);
    return { week, ...(r ? pick(r) : { value: null, n: 0 }) };
  });
}

const share = (part: number, whole: number): Share => ({ part, whole, value: ratio(part, whole) });

// -----------------------------------------------------------------------------------------------
// Queries. `since`/`now` bound the window; `week` is Monday 00:00 UTC.

const WEEK = (col: SQL) => sql`to_char(date_trunc('week', ${col} at time zone 'UTC'), 'YYYY-MM-DD')`;

const inWindow = (since: Date, now: Date) => sql`occurred_at >= ${since} and occurred_at < ${now}`;

async function qrTiming(since: Date, now: Date, weeks: Date[]): Promise<QrTiming> {
  const data = await rows<{ week: string | null; n: number; p50: number | null; p90: number | null }>(sql`
    select week, count(*)::int as n,
      percentile_cont(0.5) within group (order by v) as p50,
      percentile_cont(0.9) within group (order by v) as p90
    from (
      select ${WEEK(sql`occurred_at`)} as week, (props->>'seconds_since_take')::float8 as v
      from analytics_event
      where name = 'qr_shown' and ${inWindow(since, now)}
    ) q
    group by rollup (week)`);
  const total = data.find((r) => r.week === null);
  return {
    p50: num(total?.p50),
    p90: num(total?.p90),
    n: total?.n ?? 0,
    trend: trendOf(data, weeks, (r) => ({ value: num(r.p90), n: r.n })),
  };
}

async function pathTimings(since: Date, now: Date): Promise<PathTiming[]> {
  const data = await rows<{
    path: string;
    n: number;
    ready_p50: number | null;
    ready_p90: number | null;
    render_p50: number | null;
    render_p90: number | null;
  }>(sql`
    select props->>'path' as path, count(*)::int as n,
      percentile_cont(0.5) within group (order by (props->>'seconds_since_take')::float8)
        filter (where props->>'seconds_since_take' is not null) as ready_p50,
      percentile_cont(0.9) within group (order by (props->>'seconds_since_take')::float8)
        filter (where props->>'seconds_since_take' is not null) as ready_p90,
      percentile_cont(0.5) within group (order by (props->>'render_ms')::float8) as render_p50,
      percentile_cont(0.9) within group (order by (props->>'render_ms')::float8) as render_p90
    from analytics_event
    where name = 'render_completed' and ${inWindow(since, now)}
    group by 1
    order by n desc`);
  return data.map((r) => ({
    path: r.path,
    n: r.n,
    readyP50: num(r.ready_p50),
    readyP90: num(r.ready_p90),
    renderP50: num(r.render_p50),
    renderP90: num(r.render_p90),
  }));
}

async function renderFailures(since: Date, now: Date) {
  const [counts] = await rows<{ ok: number; failed: number }>(sql`
    select count(*) filter (where name = 'render_completed')::int as ok,
           count(*) filter (where name = 'render_failed')::int as failed
    from analytics_event
    where name in ('render_completed', 'render_failed') and ${inWindow(since, now)}`);
  const byCause = await rows<{ code: string; browser: string; count: number }>(sql`
    select props->>'error_code' as code, props->>'browser' as browser, count(*)::int as count
    from analytics_event
    where name = 'render_failed' and ${inWindow(since, now)}
    group by 1, 2
    order by count desc
    limit 25`);
  return { ok: counts?.ok ?? 0, failed: counts?.failed ?? 0, byCause };
}

/**
 * Events completed without a crash: of the events whose booths ran in the window, those with no
 * `booth_crashed` report. A session that neither ended nor reported a crash for 12 hours is counted
 * separately ("unclean"): a closed laptop lid or a killed mobile tab looks like that, so it is
 * shown, not blamed.
 */
async function crashFree(since: Date, now: Date, weeks: Date[]) {
  const data = await rows<{ week: string | null; events: number; crashed: number }>(sql`
    with started as (
      select event_id, min(occurred_at) as first_at from analytics_event
      where name = 'booth_session_started' and event_id is not null and ${inWindow(since, now)}
      group by event_id
    ), crashed as (
      select distinct event_id from analytics_event
      where name = 'booth_crashed' and event_id is not null and ${inWindow(since, now)}
    )
    select week, count(*)::int as events, count(crashed_id)::int as crashed
    from (
      select ${WEEK(sql`s.first_at`)} as week, s.event_id, c.event_id as crashed_id
      from started s left join crashed c on c.event_id = s.event_id
    ) x
    group by rollup (week)`);
  const [sessions] = await rows<{ total: number; unclean: number }>(sql`
    with s as (
      select props->>'session_id' as sid from analytics_event
      where name = 'booth_session_started' and occurred_at >= ${since} and occurred_at < ${new Date(now.getTime() - 12 * 3_600_000)}
    ), e as (
      select distinct props->>'session_id' as sid from analytics_event
      where name in ('booth_session_ended', 'booth_crashed') and occurred_at >= ${since}
    )
    select count(*)::int as total, count(*) filter (where e.sid is null)::int as unclean
    from s left join e on e.sid = s.sid`);
  const total = data.find((r) => r.week === null);
  const events = total?.events ?? 0;
  const crashed = total?.crashed ?? 0;
  return {
    ...share(events - crashed, events),
    crashed,
    sessions: sessions?.total ?? 0,
    unclean: sessions?.unclean ?? 0,
    trend: trendOf(data, weeks, (r) => ({ value: ratio(r.events - r.crashed, r.events), n: r.events })),
  };
}

/** Per session and route: viewed, and downloaded something. Matching is by session, so a guest who downloads three files is one success. */
const viewsAndDownloads = (since: Date, now: Date) => sql`
  with views as (
    select coalesce(props->>'route', 'direct') as route, props->>'session_id' as sid, min(occurred_at) as first_at
    from analytics_event
    where name = 'share_page_viewed' and props->>'session_id' is not null and ${inWindow(since, now)}
    group by 1, 2
  ), downloads as (
    select coalesce(props->>'route', 'direct') as route, props->>'session_id' as sid
    from analytics_event
    where name = 'file_downloaded' and props->>'session_id' is not null and ${inWindow(since, now)}
    group by 1, 2
  )`;

async function downloadSuccess(since: Date, now: Date, weeks: Date[]) {
  const byRoute = await rows<{ route: string; viewed: number; downloaded: number }>(sql`
    ${viewsAndDownloads(since, now)}
    select v.route, count(*)::int as viewed, count(d.sid)::int as downloaded
    from views v left join downloads d on d.route = v.route and d.sid = v.sid
    group by v.route
    order by viewed desc`);
  const weekly = await rows<{ week: string; viewed: number; downloaded: number }>(sql`
    ${viewsAndDownloads(since, now)}
    select ${WEEK(sql`v.first_at`)} as week, count(*)::int as viewed, count(d.sid)::int as downloaded
    from views v left join downloads d on d.route = v.route and d.sid = v.sid
    group by 1`);
  const viewed = byRoute.reduce((a, r) => a + r.viewed, 0);
  const downloaded = byRoute.reduce((a, r) => a + r.downloaded, 0);
  return {
    ...share(downloaded, viewed),
    byRoute: byRoute.map((r) => ({ route: r.route, ...share(r.downloaded, r.viewed) })),
    trend: trendOf(weekly, weeks, (r) => ({ value: ratio(r.downloaded, r.viewed), n: r.viewed })),
  };
}

/** Operators who have run events, as of the end of each week and now: lifetime, so the trend only grows or holds. */
const operatorsByEventCount = sql`
  with ran as (
    select e.organization_id as org, e.id as event_id, min(cs.received_at) as first_at
    from capture_session cs join event e on e.id = cs.event_id
    group by e.organization_id, e.id
  ), ranked as (
    select org, first_at, row_number() over (partition by org order by first_at) as n from ran
  ), per_org as (
    select org,
      min(first_at) filter (where n = 1) as first_event_at,
      min(first_at) filter (where n = 2) as second_event_at
    from ranked group by org
  )`;

async function multiEvent(weeks: Date[]) {
  const [current] = await rows<{ activated: number; multi: number }>(sql`
    ${operatorsByEventCount}
    select count(first_event_at)::int as activated, count(second_event_at)::int as multi from per_org`);
  const first = weeks[0]?.toISOString().slice(0, 10);
  const last = weeks.at(-1)?.toISOString().slice(0, 10);
  const weekly =
    first && last
      ? await rows<{ week: string; activated: number; multi: number }>(sql`
    ${operatorsByEventCount}
    select to_char(g, 'YYYY-MM-DD') as week,
      count(*) filter (where p.first_event_at < (g at time zone 'UTC') + interval '7 days')::int as activated,
      count(*) filter (where p.second_event_at < (g at time zone 'UTC') + interval '7 days')::int as multi
    from generate_series(${first}::timestamp, ${last}::timestamp, interval '7 days') g
    cross join per_org p
    group by g
    order by g`)
      : [];
  return {
    ...share(current?.multi ?? 0, current?.activated ?? 0),
    trend: trendOf(weekly, weeks, (r) => ({ value: ratio(r.multi, r.activated), n: r.activated })),
  };
}

async function activity(since: Date, now: Date, weeks: Date[]) {
  const data = await rows<{ week: string | null; operators: number; events: number; devices: number }>(sql`
    select week, count(distinct e.organization_id)::int as operators, count(distinct s.event_id)::int as events,
      count(distinct s.device_id)::int as devices
    from (
      select ${WEEK(sql`received_at`)} as week, event_id, device_id
      from capture_session
      where received_at >= ${since} and received_at < ${now}
    ) s
    join event e on e.id = s.event_id
    group by rollup (week)`);
  const total = data.find((r) => r.week === null);
  return {
    operators: total?.operators ?? 0,
    devices: total?.devices ?? 0,
    events: total?.events ?? 0,
    value: ratio(total?.devices ?? 0, total?.operators ?? 0),
    trend: trendOf(data, weeks, (r) => ({ value: ratio(r.devices, r.operators), n: r.operators })),
  };
}

async function costs(now: Date, days: number) {
  const months = monthBuckets(now, days);
  const first = months[0] ?? monthStart(now);
  const active = await rows<{ month: string; operators: number }>(sql`
    select to_char(date_trunc('month', cs.received_at at time zone 'UTC'), 'YYYY-MM') as month,
      count(distinct e.organization_id)::int as operators
    from capture_session cs join event e on e.id = cs.event_id
    where cs.received_at >= ${first} and cs.received_at < ${now}
    group by 1`);
  const bills = await rows<{ month: string; amount_cents: number; note: string | null }>(sql`
    select to_char(month, 'YYYY-MM') as month, amount_cents, note
    from platform_cost
    where month >= ${first.toISOString().slice(0, 10)}::date`);
  const out = months.map((m) => {
    const key = monthKey(m);
    const operators = active.find((a) => a.month === key)?.operators ?? 0;
    const bill = bills.find((b) => b.month === key);
    return {
      month: key,
      billCents: bill ? Number(bill.amount_cents) : null,
      operators,
      perOperator: costPerOperator(bill ? Number(bill.amount_cents) : null, operators),
      note: bill?.note ?? null,
    };
  });
  const latest = [...out].reverse().find((m) => m.billCents !== null);
  return {
    months: out,
    latest: latest
      ? {
          month: latest.month,
          billCents: latest.billCents!,
          operators: latest.operators,
          perOperator: latest.perOperator,
        }
      : null,
  };
}

/** Stored guest files and library assets per organization, against the 50 GB fair-use ceiling. */
async function storage() {
  const data = await rows<{ id: string; name: string; guest_bytes: number; asset_bytes: number }>(sql`
    with guest as (
      select e.organization_id as org, sum(o.bytes)::float8 as bytes
      from output o
      join capture_session cs on cs.id = o.session_id
      join event e on e.id = cs.event_id
      where o.uploaded_at is not null and cs.expired_at is null
        and (cs.removed_at is null or cs.removal = 'operator')
      group by 1
    ), assets as (
      select organization_id as org, sum(bytes)::float8 as bytes
      from asset where deleted_at is null and status = 'ready'
      group by 1
    )
    select o.id, o.name, coalesce(g.bytes, 0)::float8 as guest_bytes, coalesce(a.bytes, 0)::float8 as asset_bytes
    from organization o
    left join guest g on g.org = o.id
    left join assets a on a.org = o.id
    where g.bytes is not null or a.bytes is not null
    order by coalesce(g.bytes, 0) + coalesce(a.bytes, 0) desc
    limit 500`);
  const organizations = data.map((r) => {
    const guestBytes = Number(r.guest_bytes);
    const assetBytes = Number(r.asset_bytes);
    const bytes = guestBytes + assetBytes;
    const s = fairUseShare(bytes);
    return { id: r.id, name: r.name, guestBytes, assetBytes, bytes, share: s, level: fairUseLevel(s) };
  });
  return {
    totalBytes: organizations.reduce((a, o) => a + o.bytes, 0),
    organizations,
    near: organizations.filter((o) => o.level === 'near').length,
    over: organizations.filter((o) => o.level === 'over').length,
  };
}

export async function adminMetrics(windowDays: MetricWindow, now = new Date()): Promise<AdminMetrics> {
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const weeks = weekBuckets(now, windowDays);
  const [captureToQr, byPath, failures, crash, downloads, multi, activeOps, cost, stored] = await Promise.all([
    qrTiming(since, now, weeks),
    pathTimings(since, now),
    renderFailures(since, now),
    crashFree(since, now, weeks),
    downloadSuccess(since, now, weeks),
    multiEvent(weeks),
    activity(since, now, weeks),
    costs(now, windowDays),
    storage(),
  ]);
  return {
    windowDays,
    since,
    now,
    captureToQr,
    byPath,
    renderFailures: failures,
    crashFree: crash,
    downloadSuccess: downloads,
    multiEvent: multi,
    devicesPerOperator: activeOps,
    cost,
    storage: stored,
  };
}

// -----------------------------------------------------------------------------------------------
// The monthly bill

/** Store (or replace) a month's cloud bill, in cents. Audit-logged with the admin who entered it. */
export async function saveMonthlyBill(input: {
  month: Date;
  amountCents: number;
  note: string | null;
  actorUserId: string;
}): Promise<void> {
  const month = input.month.toISOString().slice(0, 10);
  await db().transaction(async (tx) => {
    await tx
      .insert(schema.platformCost)
      .values({ month, amountCents: input.amountCents, note: input.note, updatedBy: input.actorUserId })
      .onConflictDoUpdate({
        target: schema.platformCost.month,
        set: { amountCents: input.amountCents, note: input.note, updatedBy: input.actorUserId, updatedAt: new Date() },
      });
    await audit(
      {
        actorUserId: input.actorUserId,
        action: 'cost.set',
        target: `month:${month}`,
        meta: { amountCents: input.amountCents },
      },
      tx,
    );
  });
}

export async function deleteMonthlyBill(month: Date, actorUserId: string): Promise<void> {
  const key = month.toISOString().slice(0, 10);
  await db().transaction(async (tx) => {
    await tx.delete(schema.platformCost).where(eq(schema.platformCost.month, key));
    await audit({ actorUserId, action: 'cost.delete', target: `month:${key}` }, tx);
  });
}
