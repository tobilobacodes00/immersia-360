ALTER TABLE "upload_object" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "upload_object_output_idx" ON "upload_object" ("output_id");--> statement-breakpoint
CREATE INDEX "upload_object_queue_idx" ON "upload_object" ("status","next_attempt_at") WHERE "status" in ('pending', 'uploading');