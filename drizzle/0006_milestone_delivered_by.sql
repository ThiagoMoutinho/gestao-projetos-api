ALTER TABLE "eap_milestones" ADD COLUMN "delivered_by" text;--> statement-breakpoint
ALTER TABLE "eap_milestones" ADD CONSTRAINT "eap_milestones_delivered_by_user_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eap_milestones_delivered_by_idx" ON "eap_milestones" USING btree ("delivered_by");