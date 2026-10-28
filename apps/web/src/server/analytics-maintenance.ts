import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@immersia/db';

/**
 * Keep analytics_event's monthly partitions created from last month through three months ahead
 * (the SQL function is idempotent and also moves any rows that landed in the default partition).
 * Until it runs, inserts are still fine: the default partition takes anything outside the months
 * that exist. Returns how many partitions it created.
 */
export async function ensureAnalyticsPartitions(): Promise<number> {
  const res = await db().execute<{ created: number }>(sql`
    select analytics_ensure_partitions(
      (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date,
      (date_trunc('month', now() at time zone 'utc') + interval '3 months')::date
    ) as created`);
  return Number(res.rows[0]?.created ?? 0);
}
