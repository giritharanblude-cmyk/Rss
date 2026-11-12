ALTER TABLE "users" ADD COLUMN "email_lookup_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_lookup_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lookup_hash_unique" ON "users" USING btree ("email_lookup_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_lookup_hash_unique" ON "users" USING btree ("phone_lookup_hash");