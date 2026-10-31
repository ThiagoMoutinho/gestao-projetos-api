CREATE TABLE "project_result_links" (
	"id" text PRIMARY KEY NOT NULL,
	"achieved_id" text NOT NULL,
	"expected_id" text NOT NULL,
	"linked_by" text NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_result_links_pair_unique" UNIQUE("achieved_id","expected_id"),
	CONSTRAINT "project_result_links_distinct_chk" CHECK ("project_result_links"."achieved_id" <> "project_result_links"."expected_id")
);
--> statement-breakpoint
ALTER TABLE "eap_evidences" DROP CONSTRAINT "eap_evidences_exactly_one_parent_chk";--> statement-breakpoint
ALTER TABLE "project_results" DROP CONSTRAINT "project_results_published_complete_chk";--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD COLUMN "project_result_id" text;--> statement-breakpoint
ALTER TABLE "project_results" ADD COLUMN "published_details" jsonb;--> statement-breakpoint
ALTER TABLE "project_results" ADD COLUMN "draft_details" jsonb;--> statement-breakpoint
ALTER TABLE "project_results" ADD COLUMN "unforeseen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_results" ADD COLUMN "correction_reason" text;--> statement-breakpoint
ALTER TABLE "project_results" ADD COLUMN "correction_by" text;--> statement-breakpoint
ALTER TABLE "project_results" ADD COLUMN "correction_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_result_links" ADD CONSTRAINT "project_result_links_achieved_id_project_results_id_fk" FOREIGN KEY ("achieved_id") REFERENCES "public"."project_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_result_links" ADD CONSTRAINT "project_result_links_expected_id_project_results_id_fk" FOREIGN KEY ("expected_id") REFERENCES "public"."project_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_result_links" ADD CONSTRAINT "project_result_links_linked_by_user_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_result_links_expected_idx" ON "project_result_links" USING btree ("expected_id");--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD CONSTRAINT "eap_evidences_project_result_id_project_results_id_fk" FOREIGN KEY ("project_result_id") REFERENCES "public"."project_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_results" ADD CONSTRAINT "project_results_correction_by_user_id_fk" FOREIGN KEY ("correction_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eap_evidences_project_result_id_idx" ON "eap_evidences" USING btree ("project_result_id");--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD CONSTRAINT "eap_evidences_exactly_one_parent_chk" CHECK ((
        (CASE WHEN "eap_evidences"."phase_id" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "eap_evidences"."task_id" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "eap_evidences"."milestone_id" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "eap_evidences"."schedule_request_id" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "eap_evidences"."project_id" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "eap_evidences"."project_result_id" IS NULL THEN 0 ELSE 1 END)
      ) = 1);--> statement-breakpoint
ALTER TABLE "project_results" ADD CONSTRAINT "project_results_correction_complete_chk" CHECK ((
        (CASE WHEN "project_results"."correction_reason" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_results"."correction_by" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_results"."correction_at" IS NULL THEN 0 ELSE 1 END)
      ) IN (0, 3));--> statement-breakpoint
ALTER TABLE "project_results" ADD CONSTRAINT "project_results_published_complete_chk" CHECK ((
        ("project_results"."published_text" IS NULL) = ("project_results"."published_by" IS NULL)
        AND ("project_results"."published_text" IS NULL) = ("project_results"."published_at" IS NULL)
        AND ("project_results"."validated_by" IS NULL) = ("project_results"."validated_at" IS NULL)
        AND ("project_results"."validated_by" IS NULL OR "project_results"."published_text" IS NOT NULL)
      ));