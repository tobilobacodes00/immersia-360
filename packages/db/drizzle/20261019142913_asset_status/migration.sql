CREATE TYPE "asset_status" AS ENUM('pending', 'ready');--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "status" "asset_status" DEFAULT 'pending'::"asset_status" NOT NULL;--> statement-breakpoint
-- Rows from before this column existed were never pending uploads.
UPDATE "asset" SET "status" = 'ready';