ALTER TABLE "eap_milestones" ADD COLUMN "presenter_id" text;--> statement-breakpoint
ALTER TABLE "eap_milestones" ADD CONSTRAINT "eap_milestones_presenter_id_user_id_fk" FOREIGN KEY ("presenter_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eap_milestones_presenter_id_idx" ON "eap_milestones" USING btree ("presenter_id");