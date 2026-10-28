-- analytics_event becomes a table partitioned by month on occurred_at.
--
-- Why: it is the one table that grows with every take, render, page view and download, and the
-- admin metrics only ever read a trailing window. Monthly partitions keep each index small, make the
-- 30/90-day queries touch two to four partitions, and let old months be detached and dropped (or
-- archived) instantly instead of deleting rows.
--
-- Inserts always work: a DEFAULT partition catches an event dated outside the months that exist, and
-- analytics_ensure_partitions() (called by the hourly cron) creates the months ahead, moving any rows
-- that landed in the default partition into the month they belong to.
--
-- Retention is an operations decision: to drop a month, `DROP TABLE analytics_event_pYYYYMM`.
ALTER TABLE "analytics_event" RENAME TO "analytics_event_unpartitioned";--> statement-breakpoint
ALTER SEQUENCE "analytics_event_id_seq" RENAME TO "analytics_event_unpartitioned_id_seq";--> statement-breakpoint
ALTER INDEX "analytics_event_name_time_idx" RENAME TO "analytics_event_unpartitioned_name_time_idx";--> statement-breakpoint
ALTER INDEX "analytics_event_client_idx" RENAME TO "analytics_event_unpartitioned_client_idx";--> statement-breakpoint
CREATE TABLE "analytics_event" (
	"id" bigserial NOT NULL,
	"name" text NOT NULL,
	"props" jsonb NOT NULL,
	"organization_id" text,
	"event_id" uuid,
	"device_id" uuid,
	"client_id" uuid,
	"source" text DEFAULT 'server' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
) PARTITION BY RANGE ("occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_event_name_time_idx" ON "analytics_event" ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_event_client_idx" ON "analytics_event" ("client_id") WHERE "client_id" is not null;--> statement-breakpoint
CREATE TABLE "analytics_event_default" PARTITION OF "analytics_event" DEFAULT;--> statement-breakpoint
CREATE FUNCTION "analytics_ensure_partitions"(first_month date, last_month date) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
	m date := date_trunc('month', first_month)::date;
	created integer := 0;
	part text;
	from_ts timestamptz;
	to_ts timestamptz;
BEGIN
	WHILE m <= last_month LOOP
		part := 'analytics_event_p' || to_char(m, 'YYYYMM');
		from_ts := (m::text || ' 00:00:00+00')::timestamptz;
		to_ts := ((m + interval '1 month')::date::text || ' 00:00:00+00')::timestamptz;
		IF to_regclass(format('public.%I', part)) IS NULL THEN
			IF EXISTS (
				SELECT 1 FROM "analytics_event_default" WHERE "occurred_at" >= from_ts AND "occurred_at" < to_ts
			) THEN
				-- Rows for this month are sitting in the default partition, which would make the new
				-- partition's bounds conflict with it: take the default out, create the month, move the
				-- rows, put the default back. The lock is held to the end of this transaction, so
				-- concurrent inserts wait rather than fail.
				ALTER TABLE "analytics_event" DETACH PARTITION "analytics_event_default";
				EXECUTE format(
					'CREATE TABLE %I PARTITION OF "analytics_event" FOR VALUES FROM (%L) TO (%L)', part, from_ts, to_ts
				);
				INSERT INTO "analytics_event"
					SELECT * FROM "analytics_event_default" WHERE "occurred_at" >= from_ts AND "occurred_at" < to_ts;
				DELETE FROM "analytics_event_default" WHERE "occurred_at" >= from_ts AND "occurred_at" < to_ts;
				ALTER TABLE "analytics_event" ATTACH PARTITION "analytics_event_default" DEFAULT;
			ELSE
				EXECUTE format(
					'CREATE TABLE %I PARTITION OF "analytics_event" FOR VALUES FROM (%L) TO (%L)', part, from_ts, to_ts
				);
			END IF;
			created := created + 1;
		END IF;
		m := (m + interval '1 month')::date;
	END LOOP;
	RETURN created;
END
$$;--> statement-breakpoint
-- Every month the existing data spans (or this month, when there is none), through three months ahead.
SELECT "analytics_ensure_partitions"(
	coalesce((SELECT date_trunc('month', min("occurred_at") AT TIME ZONE 'UTC')::date FROM "analytics_event_unpartitioned"),
		date_trunc('month', now() AT TIME ZONE 'UTC')::date),
	(date_trunc('month', now() AT TIME ZONE 'UTC') + interval '3 months')::date
);--> statement-breakpoint
INSERT INTO "analytics_event" ("id", "name", "props", "organization_id", "event_id", "device_id", "client_id", "source", "occurred_at", "received_at")
SELECT "id", "name", "props", "organization_id", "event_id", "device_id", "client_id", "source", "occurred_at", "received_at"
FROM "analytics_event_unpartitioned";--> statement-breakpoint
SELECT setval(
	pg_get_serial_sequence('analytics_event', 'id'),
	coalesce((SELECT max("id") FROM "analytics_event_unpartitioned"), 0) + 1,
	false
);--> statement-breakpoint
DROP TABLE "analytics_event_unpartitioned";
