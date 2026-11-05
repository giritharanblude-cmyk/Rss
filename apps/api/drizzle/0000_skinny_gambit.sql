CREATE TYPE "public"."alert_kind" AS ENUM('digest', 'instant');--> statement-breakpoint
CREATE TYPE "public"."connection_service" AS ENUM('whatsapp', 'email');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('granted', 'revoked', 'pending');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'delivered', 'retrying', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('login', 'password_change');--> statement-breakpoint
CREATE TYPE "public"."recipient_channel" AS ENUM('whatsapp', 'email', 'both');--> statement-breakpoint
CREATE TYPE "public"."source_mode" AS ENUM('all', 'topics');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('master', 'member');--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "alert_kind" DEFAULT 'digest' NOT NULL,
	"days_of_week" integer[] DEFAULT '{}' NOT NULL,
	"time_local" text DEFAULT '08:00' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"topics" text[] DEFAULT '{}' NOT NULL,
	"channels" "recipient_channel"[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" "connection_service" NOT NULL,
	"state" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"subject_or_ref" text,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"news_item_ids" uuid[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"headline" text NOT NULL,
	"summary" text NOT NULL,
	"link" text NOT NULL,
	"link_normalized" text NOT NULL,
	"headline_signature" text NOT NULL,
	"category" text NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"important" boolean DEFAULT false NOT NULL,
	"duplicate_of" uuid
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"whatsapp_e164" text,
	"email" text,
	"topics" text[] DEFAULT '{}' NOT NULL,
	"channel" "recipient_channel" DEFAULT 'email' NOT NULL,
	"consent_status" "consent_status" DEFAULT 'pending' NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_note" text,
	"unsubscribe_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"encrypted_value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"website" text NOT NULL,
	"rss_url" text NOT NULL,
	"mode" "source_mode" DEFAULT 'all' NOT NULL,
	"topics" text[] DEFAULT '{}' NOT NULL,
	"region" text,
	"interval_minutes" integer DEFAULT 60 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_status" text,
	"etag" text,
	"last_modified" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"login_failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_duplicate_of_news_items_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."news_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_status_service_unique" ON "connection_status" USING btree ("service");--> statement-breakpoint
CREATE INDEX "deliveries_status_idx" ON "deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deliveries_queued_at_idx" ON "deliveries" USING btree ("queued_at");--> statement-breakpoint
CREATE INDEX "jobs_status_run_at_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "news_items_link_normalized_idx" ON "news_items" USING btree ("link_normalized");--> statement-breakpoint
CREATE INDEX "news_items_headline_signature_idx" ON "news_items" USING btree ("headline_signature");--> statement-breakpoint
CREATE INDEX "news_items_published_at_idx" ON "news_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "news_items_category_idx" ON "news_items" USING btree ("category");--> statement-breakpoint
CREATE INDEX "otp_codes_user_purpose_idx" ON "otp_codes" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "recipients_unsubscribe_token_unique" ON "recipients" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE UNIQUE INDEX "users_name_key_unique" ON "users" USING btree ("name_key");