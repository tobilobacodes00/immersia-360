CREATE TABLE "event_highlight" (
	"id" uuid PRIMARY KEY,
	"event_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"poster_key" text,
	"mime" text DEFAULT 'video/mp4' NOT NULL,
	"bytes" bigint NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"session_ids" jsonb DEFAULT '[]' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "display_scans" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "event_highlight_event_idx" ON "event_highlight" ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_highlight_live_idx" ON "event_highlight" ("event_id") WHERE "uploaded_at" is not null;--> statement-breakpoint
ALTER TABLE "event_highlight" ADD CONSTRAINT "event_highlight_event_id_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_highlight" ADD CONSTRAINT "event_highlight_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;