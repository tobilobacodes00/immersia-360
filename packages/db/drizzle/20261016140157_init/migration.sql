CREATE TYPE "asset_type" AS ENUM('overlay', 'layout', 'intro', 'outro', 'audio', 'font', 'logo', 'background');--> statement-breakpoint
CREATE TYPE "booth_mode" AS ENUM('video360', 'photo');--> statement-breakpoint
CREATE TYPE "capture_trigger" AS ENUM('tap', 'timer', 'motion', 'remote', 'keyboard', 'import');--> statement-breakpoint
CREATE TYPE "display_layout" AS ENUM('spotlight', 'mosaic', 'ticker', 'counter');--> statement-breakpoint
CREATE TYPE "display_status" AS ENUM('pending', 'shown', 'hidden', 'opted_out');--> statement-breakpoint
CREATE TYPE "event_status" AS ENUM('draft', 'live', 'archived');--> statement-breakpoint
CREATE TYPE "integration_provider" AS ENUM('drive', 'dropbox');--> statement-breakpoint
CREATE TYPE "integration_status" AS ENUM('connected', 'needs_reauth', 'revoked');--> statement-breakpoint
CREATE TYPE "moderation_mode" AS ENUM('auto', 'approve');--> statement-breakpoint
CREATE TYPE "output_kind" AS ENUM('mp4', 'small_mp4', 'gif', 'strip', 'short_video', 'boomerang', 'poster');--> statement-breakpoint
CREATE TYPE "render_job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "report_reason" AS ENUM('not_me', 'inappropriate', 'illegal', 'privacy', 'other');--> statement-breakpoint
CREATE TYPE "report_status" AS ENUM('open', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TYPE "session_status" AS ENUM('pending', 'live', 'expired');--> statement-breakpoint
CREATE TYPE "take_status" AS ENUM('local', 'uploading', 'uploaded', 'failed');--> statement-breakpoint
CREATE TYPE "template_kind" AS ENUM('layout', 'overlay');--> statement-breakpoint
CREATE TYPE "upload_status" AS ENUM('pending', 'uploading', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "upload_target" AS ENUM('hosted', 'drive', 'dropbox');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'operator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_event" (
	"id" bigserial,
	"name" text NOT NULL,
	"props" jsonb NOT NULL,
	"organization_id" text,
	"event_id" uuid,
	"device_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY,
	"organization_id" text NOT NULL,
	"type" "asset_type" NOT NULL,
	"name" text NOT NULL,
	"object_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"meta" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY,
	"organization_id" text,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_session" (
	"id" uuid PRIMARY KEY,
	"event_id" uuid NOT NULL,
	"device_id" uuid,
	"link_id" text NOT NULL,
	"short_code" text NOT NULL,
	"filename_prefix" text DEFAULT '' NOT NULL,
	"status" "session_status" DEFAULT 'pending'::"session_status" NOT NULL,
	"opted_out_of_display" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"expired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"browser" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"registered_by" text,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "display" (
	"id" uuid PRIMARY KEY,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"layout" "display_layout" DEFAULT 'spotlight'::"display_layout" NOT NULL,
	"settings" jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"paired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "display_pairing" (
	"code" text PRIMARY KEY,
	"event_id" uuid NOT NULL,
	"created_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"display_id" uuid
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"mode" "booth_mode" NOT NULL,
	"status" "event_status" DEFAULT 'draft'::"event_status" NOT NULL,
	"output_settings" jsonb NOT NULL,
	"share_settings" jsonb NOT NULL,
	"branding" jsonb NOT NULL,
	"expiry_days" smallint DEFAULT 30 NOT NULL,
	"filename_prefix_enabled" boolean DEFAULT false NOT NULL,
	"filename_sequence" integer DEFAULT 1 NOT NULL,
	"live_display_enabled" boolean DEFAULT false NOT NULL,
	"moderation" "moderation_mode" DEFAULT 'auto'::"moderation_mode" NOT NULL,
	"kiosk_pin_hash" text,
	"gallery_slug" text NOT NULL,
	"gallery_password_hash" text,
	"duplicated_from_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "event_expiry_days_check" CHECK ("expiry_days" in (7, 30, 90))
);
--> statement-breakpoint
CREATE TABLE "guest_contact" (
	"id" uuid PRIMARY KEY,
	"event_id" uuid NOT NULL,
	"session_id" uuid,
	"name" text,
	"email" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration" (
	"id" uuid PRIMARY KEY,
	"organization_id" text NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"account_email" text,
	"folder_id" text,
	"folder_name" text,
	"status" "integration_status" DEFAULT 'connected'::"integration_status" NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "output" (
	"id" uuid PRIMARY KEY,
	"session_id" uuid NOT NULL,
	"take_id" uuid,
	"kind" "output_kind" NOT NULL,
	"object_key" text,
	"mime" text NOT NULL,
	"bytes" bigint,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"display_status" "display_status" DEFAULT 'pending'::"display_status" NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "output_session_kind_take_uq" UNIQUE NULLS NOT DISTINCT("session_id","kind","take_id")
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" uuid PRIMARY KEY,
	"session_id" uuid NOT NULL,
	"output_id" uuid,
	"reason" "report_reason" NOT NULL,
	"details" text,
	"reporter_hash" text,
	"status" "report_status" DEFAULT 'open'::"report_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actioned_at" timestamp with time zone,
	"actioned_by" text
);
--> statement-breakpoint
CREATE TABLE "server_render_job" (
	"id" uuid PRIMARY KEY,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"take_id" uuid NOT NULL,
	"recipe" jsonb NOT NULL,
	"status" "render_job_status" DEFAULT 'queued'::"render_job_status" NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "short_code_reservation" (
	"code" text PRIMARY KEY,
	"event_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "take" (
	"id" uuid PRIMARY KEY,
	"event_id" uuid NOT NULL,
	"device_id" uuid,
	"raw_object_key" text,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer NOT NULL,
	"fps" smallint NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"trigger" "capture_trigger" NOT NULL,
	"status" "take_status" DEFAULT 'local'::"take_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template" (
	"id" uuid PRIMARY KEY,
	"organization_id" text,
	"event_id" uuid,
	"kind" "template_kind" NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"canvas" jsonb NOT NULL,
	"elements" jsonb NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_object" (
	"id" uuid PRIMARY KEY,
	"output_id" uuid NOT NULL,
	"target" "upload_target" NOT NULL,
	"idempotency_key" text NOT NULL,
	"remote_id" text,
	"remote_url" text,
	"status" "upload_status" DEFAULT 'pending'::"upload_status" NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_org_idx" ON "invitation" ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" ("email");--> statement-breakpoint
CREATE INDEX "member_org_idx" ON "member" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_idx" ON "member" ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_idx" ON "organization" ("slug");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "analytics_event_name_time_idx" ON "analytics_event" ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "asset_org_type_idx" ON "asset" ("organization_id","type");--> statement-breakpoint
CREATE INDEX "audit_log_org_time_idx" ON "audit_log" ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "capture_session_link_idx" ON "capture_session" ("link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capture_session_code_idx" ON "capture_session" ("short_code");--> statement-breakpoint
CREATE INDEX "capture_session_event_idx" ON "capture_session" ("event_id","captured_at");--> statement-breakpoint
CREATE INDEX "capture_session_expiry_idx" ON "capture_session" ("expires_at") WHERE "expired_at" is null;--> statement-breakpoint
CREATE INDEX "device_org_idx" ON "device" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_token_idx" ON "device" ("token_hash");--> statement-breakpoint
CREATE INDEX "display_event_idx" ON "display" ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "display_token_idx" ON "display" ("token_hash");--> statement-breakpoint
CREATE INDEX "display_pairing_event_idx" ON "display_pairing" ("event_id");--> statement-breakpoint
CREATE INDEX "event_org_date_idx" ON "event" ("organization_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "event_gallery_slug_idx" ON "event" ("gallery_slug");--> statement-breakpoint
CREATE INDEX "guest_contact_event_idx" ON "guest_contact" ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_org_provider_idx" ON "integration" ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "output_session_idx" ON "output" ("session_id");--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "report" ("status","created_at");--> statement-breakpoint
CREATE INDEX "server_render_job_status_idx" ON "server_render_job" ("status","created_at");--> statement-breakpoint
CREATE INDEX "short_code_device_free_idx" ON "short_code_reservation" ("device_id","event_id") WHERE "used_at" is null;--> statement-breakpoint
CREATE INDEX "take_event_idx" ON "take" ("event_id","captured_at");--> statement-breakpoint
CREATE INDEX "template_org_idx" ON "template" ("organization_id");--> statement-breakpoint
CREATE INDEX "template_event_idx" ON "template" ("event_id");--> statement-breakpoint
CREATE INDEX "template_library_idx" ON "template" ("kind","category") WHERE "organization_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "upload_object_idem_idx" ON "upload_object" ("idempotency_key");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "capture_session" ADD CONSTRAINT "capture_session_event_id_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "capture_session" ADD CONSTRAINT "capture_session_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_registered_by_user_id_fkey" FOREIGN KEY ("registered_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "display" ADD CONSTRAINT "display_event_id_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "display_pairing" ADD CONSTRAINT "display_pairing_event_id_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "display_pairing" ADD CONSTRAINT "display_pairing_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "display_pairing" ADD CONSTRAINT "display_pairing_display_id_display_id_fkey" FOREIGN KEY ("display_id") REFERENCES "display"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "guest_contact" ADD CONSTRAINT "guest_contact_event_id_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "guest_contact" ADD CONSTRAINT "guest_contact_session_id_capture_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "capture_session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "output" ADD CONSTRAINT "output_session_id_capture_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "capture_session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "output" ADD CONSTRAINT "output_take_id_take_id_fkey" FOREIGN KEY ("take_id") REFERENCES "take"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_session_id_capture_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "capture_session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_output_id_output_id_fkey" FOREIGN KEY ("output_id") REFERENCES "output"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_actioned_by_user_id_fkey" FOREIGN KEY ("actioned_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "server_render_job" ADD CONSTRAINT "server_render_job_event_id_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "server_render_job" ADD CONSTRAINT "server_render_job_session_id_capture_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "capture_session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "server_render_job" ADD CONSTRAINT "server_render_job_take_id_take_id_fkey" FOREIGN KEY ("take_id") REFERENCES "take"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "short_code_reservation" ADD CONSTRAINT "short_code_reservation_event_id_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "short_code_reservation" ADD CONSTRAINT "short_code_reservation_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "take" ADD CONSTRAINT "take_event_id_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "take" ADD CONSTRAINT "take_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_event_id_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "upload_object" ADD CONSTRAINT "upload_object_output_id_output_id_fkey" FOREIGN KEY ("output_id") REFERENCES "output"("id") ON DELETE CASCADE;