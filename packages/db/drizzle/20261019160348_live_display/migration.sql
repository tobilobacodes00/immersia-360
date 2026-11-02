ALTER TABLE "capture_session" ADD COLUMN "display_status" "display_status" DEFAULT 'pending'::"display_status" NOT NULL;--> statement-breakpoint
ALTER TABLE "capture_session" ADD COLUMN "displayed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "capture_session_display_idx" ON "capture_session" ("event_id","display_status","displayed_at");