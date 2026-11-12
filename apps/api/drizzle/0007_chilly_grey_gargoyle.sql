ALTER TABLE "alert_rules" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "recipients" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_rules_owner_user_id_idx" ON "alert_rules" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "deliveries_owner_user_id_idx" ON "deliveries" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "recipients_owner_user_id_idx" ON "recipients" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "sources_owner_user_id_idx" ON "sources" USING btree ("owner_user_id");