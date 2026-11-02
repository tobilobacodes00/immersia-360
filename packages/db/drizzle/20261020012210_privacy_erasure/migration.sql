CREATE TABLE "organization_deletion" (
	"id" uuid PRIMARY KEY,
	"organization_id" text NOT NULL,
	"storage_prefix" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"objects_deleted" integer DEFAULT 0 NOT NULL,
	"analytics_purged_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guest_contact" ADD COLUMN "consent_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_contact" ADD COLUMN "consent_locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_contact" ADD COLUMN "policy_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "capture_session_erased_idx" ON "capture_session" ("erased_at") WHERE "erased_at" is not null;--> statement-breakpoint
CREATE INDEX "guest_contact_session_idx" ON "guest_contact" ("session_id");--> statement-breakpoint
CREATE INDEX "guest_contact_email_idx" ON "guest_contact" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_contact_session_email_idx" ON "guest_contact" ("session_id","email") WHERE "session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_contact_event_email_idx" ON "guest_contact" ("event_id","email") WHERE "session_id" is null;--> statement-breakpoint
CREATE INDEX "organization_deletion_open_idx" ON "organization_deletion" ("requested_at") WHERE "completed_at" is null;--> statement-breakpoint
ALTER TABLE "guest_contact" DROP CONSTRAINT "guest_contact_session_id_capture_session_id_fkey", ADD CONSTRAINT "guest_contact_session_id_capture_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "capture_session"("id") ON DELETE CASCADE;