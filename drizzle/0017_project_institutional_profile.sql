CREATE TYPE "public"."project_profile_field" AS ENUM('PURPOSE', 'SCOPE', 'PROBLEM', 'REQUESTING_AREA', 'RESPONSIBLE_AREA', 'BENEFITED_SECTORS');--> statement-breakpoint
CREATE TYPE "public"."project_result_type" AS ENUM('ESPERADO', 'ALCANCADO');--> statement-breakpoint
ALTER TYPE "public"."eap_audit_action" ADD VALUE 'INSTITUTIONAL_VALIDATE';--> statement-breakpoint
CREATE TABLE "project_highlights" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"milestone_id" text NOT NULL,
	"highlighted_by" text NOT NULL,
	"highlighted_at" timestamp DEFAULT now() NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "project_highlights_project_milestone_unique" UNIQUE("project_id","milestone_id"),
	CONSTRAINT "project_highlights_sort_order_chk" CHECK ("project_highlights"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_profile_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"field" "project_profile_field" NOT NULL,
	"published_value" text,
	"published_by" text,
	"published_at" timestamp,
	"validated_by" text,
	"validated_at" timestamp,
	"draft_value" text,
	"draft_by" text,
	"draft_at" timestamp,
	CONSTRAINT "project_profile_fields_project_field_unique" UNIQUE("project_id","field"),
	CONSTRAINT "project_profile_fields_published_complete_chk" CHECK ((
        (CASE WHEN "project_profile_fields"."published_value" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_profile_fields"."published_by" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_profile_fields"."published_at" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_profile_fields"."validated_by" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_profile_fields"."validated_at" IS NULL THEN 0 ELSE 1 END)
      ) IN (0, 5)),
	CONSTRAINT "project_profile_fields_draft_complete_chk" CHECK ((
        (CASE WHEN "project_profile_fields"."draft_value" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_profile_fields"."draft_by" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_profile_fields"."draft_at" IS NULL THEN 0 ELSE 1 END)
      ) IN (0, 3)),
	CONSTRAINT "project_profile_fields_has_version_chk" CHECK ("project_profile_fields"."published_value" IS NOT NULL OR "project_profile_fields"."draft_value" IS NOT NULL),
	CONSTRAINT "project_profile_fields_no_self_validation_chk" CHECK ("project_profile_fields"."validated_by" IS NULL OR "project_profile_fields"."validated_by" <> "project_profile_fields"."published_by"),
	CONSTRAINT "project_profile_fields_text_chk" CHECK (("project_profile_fields"."published_value" IS NULL OR btrim("project_profile_fields"."published_value") <> '')
        AND ("project_profile_fields"."draft_value" IS NULL OR btrim("project_profile_fields"."draft_value") <> ''))
);
--> statement-breakpoint
CREATE TABLE "project_results" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"type" "project_result_type" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_text" text,
	"published_result_date" timestamp,
	"published_milestone_id" text,
	"published_by" text,
	"published_at" timestamp,
	"validated_by" text,
	"validated_at" timestamp,
	"draft_text" text,
	"draft_result_date" timestamp,
	"draft_milestone_id" text,
	"draft_by" text,
	"draft_at" timestamp,
	"archived_by" text,
	"archived_at" timestamp,
	CONSTRAINT "project_results_archived_complete_chk" CHECK (("project_results"."archived_by" IS NULL) = ("project_results"."archived_at" IS NULL)),
	CONSTRAINT "project_results_published_complete_chk" CHECK ((
        (CASE WHEN "project_results"."published_text" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_results"."published_by" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_results"."published_at" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_results"."validated_by" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_results"."validated_at" IS NULL THEN 0 ELSE 1 END)
      ) IN (0, 5)),
	CONSTRAINT "project_results_draft_complete_chk" CHECK ((
        (CASE WHEN "project_results"."draft_text" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_results"."draft_by" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "project_results"."draft_at" IS NULL THEN 0 ELSE 1 END)
      ) IN (0, 3)),
	CONSTRAINT "project_results_has_version_chk" CHECK ("project_results"."published_text" IS NOT NULL OR "project_results"."draft_text" IS NOT NULL),
	CONSTRAINT "project_results_no_self_validation_chk" CHECK ("project_results"."validated_by" IS NULL OR "project_results"."validated_by" <> "project_results"."published_by"),
	CONSTRAINT "project_results_text_chk" CHECK (("project_results"."published_text" IS NULL OR btrim("project_results"."published_text") <> '')
        AND ("project_results"."draft_text" IS NULL OR btrim("project_results"."draft_text") <> ''))
);
--> statement-breakpoint
ALTER TABLE "eap_evidences" DROP CONSTRAINT "eap_evidences_exactly_one_parent_chk";--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "pmo_glpi_ticket_id" text;--> statement-breakpoint
ALTER TABLE "project_highlights" ADD CONSTRAINT "project_highlights_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_highlights" ADD CONSTRAINT "project_highlights_milestone_id_eap_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."eap_milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_highlights" ADD CONSTRAINT "project_highlights_highlighted_by_user_id_fk" FOREIGN KEY ("highlighted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_profile_fields" ADD CONSTRAINT "project_profile_fields_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_profile_fields" ADD CONSTRAINT "project_profile_fields_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_profile_fields" ADD CONSTRAINT "project_profile_fields_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_profile_fields" ADD CONSTRAINT "project_profile_fields_draft_by_user_id_fk" FOREIGN KEY ("draft_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_results" ADD CONSTRAINT "project_results_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_results" ADD CONSTRAINT "project_results_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_results" ADD CONSTRAINT "project_results_published_milestone_id_eap_milestones_id_fk" FOREIGN KEY ("published_milestone_id") REFERENCES "public"."eap_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_results" ADD CONSTRAINT "project_results_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_results" ADD CONSTRAINT "project_results_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_results" ADD CONSTRAINT "project_results_draft_milestone_id_eap_milestones_id_fk" FOREIGN KEY ("draft_milestone_id") REFERENCES "public"."eap_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_results" ADD CONSTRAINT "project_results_draft_by_user_id_fk" FOREIGN KEY ("draft_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_results" ADD CONSTRAINT "project_results_archived_by_user_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_highlights_project_id_idx" ON "project_highlights" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_profile_fields_project_id_idx" ON "project_profile_fields" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_results_project_id_idx" ON "project_results" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD CONSTRAINT "eap_evidences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eap_evidences_project_id_idx" ON "eap_evidences" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD CONSTRAINT "eap_evidences_exactly_one_parent_chk" CHECK ((
        (CASE WHEN "eap_evidences"."phase_id" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "eap_evidences"."task_id" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "eap_evidences"."milestone_id" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "eap_evidences"."schedule_request_id" IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN "eap_evidences"."project_id" IS NULL THEN 0 ELSE 1 END)
      ) = 1);