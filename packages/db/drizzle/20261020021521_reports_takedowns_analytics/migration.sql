CREATE TYPE "removal_basis" AS ENUM('operator', 'policy', 'legal');--> statement-breakpoint
ALTER TYPE "report_status" ADD VALUE 'escalated';--> statement-breakpoint
CREATE TABLE "platform_cost" (
	"month" date PRIMARY KEY,
	"amount_cents" integer NOT NULL,
	"note" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_cost_amount_check" CHECK ("amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "analytics_event" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "analytics_event" ADD COLUMN "source" text DEFAULT 'server' NOT NULL;--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "removal" "removal_basis";--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "removed_by" text;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "decision_note" text;--> statement-breakpoint
CREATE INDEX "analytics_event_client_idx" ON "analytics_event" ("client_id") WHERE "client_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_log_action_time_idx" ON "audit_log" ("action","created_at");--> statement-breakpoint
CREATE INDEX "report_session_idx" ON "report" ("session_id","created_at");--> statement-breakpoint
ALTER TABLE "capture_session" ADD CONSTRAINT "capture_session_removed_by_user_id_fkey" FOREIGN KEY ("removed_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "platform_cost" ADD CONSTRAINT "platform_cost_updated_by_user_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE SET NULL;