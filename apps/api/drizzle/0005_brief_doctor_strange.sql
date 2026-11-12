ALTER TYPE "public"."otp_purpose" ADD VALUE 'contact_change';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;