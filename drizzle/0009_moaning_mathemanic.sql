ALTER TABLE "eap_evidences" DROP CONSTRAINT "eap_evidences_exactly_one_parent_chk";--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD COLUMN "phase_id" text;--> statement-breakpoint
ALTER TABLE "eap_phases" ADD COLUMN "responsible_id" text;--> statement-breakpoint
ALTER TABLE "eap_phases" ADD COLUMN "completion_criteria" text;--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD CONSTRAINT "eap_evidences_phase_id_eap_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."eap_phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_phases" ADD CONSTRAINT "eap_phases_responsible_id_user_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eap_evidences_phase_id_idx" ON "eap_evidences" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "eap_phases_responsible_id_idx" ON "eap_phases" USING btree ("responsible_id");--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD CONSTRAINT "eap_evidences_exactly_one_parent_chk" CHECK ((
        (CASE WHEN "eap_evidences"."phase_id" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "eap_evidences"."task_id" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "eap_evidences"."milestone_id" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "eap_evidences"."schedule_request_id" IS NULL THEN 0 ELSE 1 END)
      ) = 1);