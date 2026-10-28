ALTER TABLE "server_render_job" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "server_render_job" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "server_render_job" ADD COLUMN "claim_token" text;--> statement-breakpoint
ALTER TABLE "server_render_job" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "server_render_job" ADD COLUMN "render_ms" integer;--> statement-breakpoint
CREATE INDEX "server_render_job_event_idx" ON "server_render_job" ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "server_render_job_queue_idx" ON "server_render_job" ("status","next_attempt_at") WHERE "status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "server_render_job_take_active_idx" ON "server_render_job" ("take_id") WHERE "status" in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "server_render_job" ADD CONSTRAINT "server_render_job_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL;