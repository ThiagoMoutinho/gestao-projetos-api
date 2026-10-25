ALTER TYPE "public"."eap_milestone_type" ADD VALUE 'HOMOLOGACAO';--> statement-breakpoint
ALTER TABLE "eap_milestone_deliveries" ADD COLUMN "nonconformities" text;--> statement-breakpoint
ALTER TABLE "eap_tasks" ADD COLUMN "corrective_milestone_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "baseline_start_at" timestamp;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "baseline_end_at" timestamp;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "planned_start_at" timestamp;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "planned_end_at" timestamp;--> statement-breakpoint
ALTER TABLE "eap_tasks" ADD CONSTRAINT "eap_tasks_corrective_milestone_id_eap_milestones_id_fk" FOREIGN KEY ("corrective_milestone_id") REFERENCES "public"."eap_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eap_tasks_corrective_milestone_id_idx" ON "eap_tasks" USING btree ("corrective_milestone_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_planned_dates_chk" CHECK ("projects"."planned_end_at" IS NULL OR "projects"."planned_start_at" IS NULL OR "projects"."planned_end_at" >= "projects"."planned_start_at");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_baseline_dates_chk" CHECK ("projects"."baseline_end_at" IS NULL OR "projects"."baseline_start_at" IS NULL OR "projects"."baseline_end_at" >= "projects"."baseline_start_at");