CREATE TYPE "public"."eap_audit_action" AS ENUM('CREATE', 'UPDATE', 'STATUS_CHANGE', 'SCHEDULE_REQUEST', 'SCHEDULE_APPROVE', 'SCHEDULE_REJECT', 'SCHEDULE_CANCEL', 'SCHEDULE_STALE', 'SCHEDULE_CHANGE', 'VALIDATE', 'IMPEDE', 'CLEAR_IMPEDIMENT');--> statement-breakpoint
CREATE TYPE "public"."eap_milestone_status" AS ENUM('PENDENTE', 'ENTREGUE', 'APROVADO', 'REJEITADO');--> statement-breakpoint
CREATE TYPE "public"."eap_milestone_type" AS ENUM('ENTREGA', 'APROVACAO');--> statement-breakpoint
CREATE TYPE "public"."eap_phase_status" AS ENUM('NAO_INICIADA', 'EM_ANDAMENTO', 'CONCLUIDA', 'SUSPENSA');--> statement-breakpoint
CREATE TYPE "public"."eap_schedule_field" AS ENUM('PLANNED_START_AT', 'PLANNED_END_AT', 'PLANNED_AT');--> statement-breakpoint
CREATE TYPE "public"."eap_schedule_request_status" AS ENUM('PENDENTE', 'APROVADA', 'REJEITADA', 'CANCELADA', 'CANCELADA_CONFLITO');--> statement-breakpoint
CREATE TYPE "public"."eap_task_status" AS ENUM('NAO_INICIADA', 'EM_ANDAMENTO', 'IMPEDIDA', 'CONCLUIDA', 'CANCELADA');--> statement-breakpoint
CREATE TABLE "eap_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" "eap_audit_action" NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb,
	"actor_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eap_evidences" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"milestone_id" text,
	"schedule_request_id" text,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "eap_evidences_exactly_one_parent_chk" CHECK ((
        (
          "eap_evidences"."task_id" IS NOT NULL
          AND "eap_evidences"."milestone_id" IS NULL
          AND "eap_evidences"."schedule_request_id" IS NULL
        ) OR (
          "eap_evidences"."task_id" IS NULL
          AND "eap_evidences"."milestone_id" IS NOT NULL
          AND "eap_evidences"."schedule_request_id" IS NULL
        ) OR (
          "eap_evidences"."task_id" IS NULL
          AND "eap_evidences"."milestone_id" IS NULL
          AND "eap_evidences"."schedule_request_id" IS NOT NULL
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "eap_impediments" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"description" text NOT NULL,
	"opened_by" text NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp,
	"resolution_note" text,
	CONSTRAINT "eap_impediments_resolution_chk" CHECK ((
        (
          "eap_impediments"."resolved_at" IS NULL
          AND "eap_impediments"."resolved_by" IS NULL
          AND "eap_impediments"."resolution_note" IS NULL
        ) OR (
          "eap_impediments"."resolved_at" IS NOT NULL
          AND "eap_impediments"."resolved_by" IS NOT NULL
          AND "eap_impediments"."resolved_at" >= "eap_impediments"."opened_at"
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "eap_milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"phase_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"type" "eap_milestone_type" NOT NULL,
	"status" "eap_milestone_status" DEFAULT 'PENDENTE' NOT NULL,
	"baseline_at" timestamp,
	"planned_at" timestamp,
	"actual_at" timestamp,
	"validated_by" text,
	"validation_note" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eap_phases" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer NOT NULL,
	"status" "eap_phase_status" DEFAULT 'NAO_INICIADA' NOT NULL,
	"baseline_start_at" timestamp,
	"baseline_end_at" timestamp,
	"planned_start_at" timestamp,
	"planned_end_at" timestamp,
	"actual_start_at" timestamp,
	"actual_end_at" timestamp,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "eap_phases_project_sort_order_unique" UNIQUE("project_id","sort_order"),
	CONSTRAINT "eap_phases_sort_order_chk" CHECK ("eap_phases"."sort_order" >= 0),
	CONSTRAINT "eap_phases_planned_dates_chk" CHECK ("eap_phases"."planned_end_at" IS NULL OR "eap_phases"."planned_start_at" IS NULL OR "eap_phases"."planned_end_at" >= "eap_phases"."planned_start_at"),
	CONSTRAINT "eap_phases_baseline_dates_chk" CHECK ("eap_phases"."baseline_end_at" IS NULL OR "eap_phases"."baseline_start_at" IS NULL OR "eap_phases"."baseline_end_at" >= "eap_phases"."baseline_start_at"),
	CONSTRAINT "eap_phases_actual_dates_chk" CHECK ("eap_phases"."actual_end_at" IS NULL OR ("eap_phases"."actual_start_at" IS NOT NULL AND "eap_phases"."actual_end_at" >= "eap_phases"."actual_start_at"))
);
--> statement-breakpoint
CREATE TABLE "eap_schedule_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"request_id" text NOT NULL,
	"phase_id" text,
	"task_id" text,
	"milestone_id" text,
	"field" "eap_schedule_field" NOT NULL,
	"baseline_value" timestamp,
	"old_value" timestamp,
	"new_value" timestamp NOT NULL,
	"changed_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "eap_schedule_changes_target_chk" CHECK ((
      (
        "eap_schedule_changes"."phase_id" IS NOT NULL
        AND "eap_schedule_changes"."task_id" IS NULL
        AND "eap_schedule_changes"."milestone_id" IS NULL
        AND "eap_schedule_changes"."field" IN ('PLANNED_START_AT', 'PLANNED_END_AT')
      ) OR (
        "eap_schedule_changes"."phase_id" IS NULL
        AND "eap_schedule_changes"."task_id" IS NOT NULL
        AND "eap_schedule_changes"."milestone_id" IS NULL
        AND "eap_schedule_changes"."field" IN ('PLANNED_START_AT', 'PLANNED_END_AT')
      ) OR (
        "eap_schedule_changes"."phase_id" IS NULL
        AND "eap_schedule_changes"."task_id" IS NULL
        AND "eap_schedule_changes"."milestone_id" IS NOT NULL
        AND "eap_schedule_changes"."field" = 'PLANNED_AT'
      )
    ))
);
--> statement-breakpoint
CREATE TABLE "eap_schedule_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"phase_id" text,
	"task_id" text,
	"milestone_id" text,
	"field" "eap_schedule_field" NOT NULL,
	"baseline_value" timestamp,
	"expected_current_value" timestamp,
	"proposed_value" timestamp NOT NULL,
	"justification" text NOT NULL,
	"status" "eap_schedule_request_status" DEFAULT 'PENDENTE' NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "eap_schedule_requests_justification_chk" CHECK (char_length(btrim("eap_schedule_requests"."justification")) >= 10),
	CONSTRAINT "eap_schedule_requests_target_chk" CHECK ((
      (
        "eap_schedule_requests"."phase_id" IS NOT NULL
        AND "eap_schedule_requests"."task_id" IS NULL
        AND "eap_schedule_requests"."milestone_id" IS NULL
        AND "eap_schedule_requests"."field" IN ('PLANNED_START_AT', 'PLANNED_END_AT')
      ) OR (
        "eap_schedule_requests"."phase_id" IS NULL
        AND "eap_schedule_requests"."task_id" IS NOT NULL
        AND "eap_schedule_requests"."milestone_id" IS NULL
        AND "eap_schedule_requests"."field" IN ('PLANNED_START_AT', 'PLANNED_END_AT')
      ) OR (
        "eap_schedule_requests"."phase_id" IS NULL
        AND "eap_schedule_requests"."task_id" IS NULL
        AND "eap_schedule_requests"."milestone_id" IS NOT NULL
        AND "eap_schedule_requests"."field" = 'PLANNED_AT'
      )
    )),
	CONSTRAINT "eap_schedule_requests_status_review_chk" CHECK ((
        (
          "eap_schedule_requests"."status" = 'PENDENTE'
          AND "eap_schedule_requests"."reviewed_by" IS NULL
          AND "eap_schedule_requests"."reviewed_at" IS NULL
          AND "eap_schedule_requests"."decision_note" IS NULL
        ) OR (
          "eap_schedule_requests"."status" = 'APROVADA'
          AND "eap_schedule_requests"."reviewed_by" IS NOT NULL
          AND "eap_schedule_requests"."reviewed_at" IS NOT NULL
        ) OR (
          "eap_schedule_requests"."status" = 'REJEITADA'
          AND "eap_schedule_requests"."reviewed_by" IS NOT NULL
          AND "eap_schedule_requests"."reviewed_at" IS NOT NULL
          AND "eap_schedule_requests"."decision_note" IS NOT NULL
          AND char_length(btrim("eap_schedule_requests"."decision_note")) >= 10
        ) OR (
          "eap_schedule_requests"."status" = 'CANCELADA'
          AND "eap_schedule_requests"."reviewed_by" IS NULL
          AND "eap_schedule_requests"."reviewed_at" IS NOT NULL
        ) OR (
          "eap_schedule_requests"."status" = 'CANCELADA_CONFLITO'
          AND "eap_schedule_requests"."reviewed_by" IS NULL
          AND "eap_schedule_requests"."reviewed_at" IS NOT NULL
          AND "eap_schedule_requests"."decision_note" IS NOT NULL
          AND char_length(btrim("eap_schedule_requests"."decision_note")) >= 10
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "eap_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"phase_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_id" text,
	"status" "eap_task_status" DEFAULT 'NAO_INICIADA' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"baseline_start_at" timestamp,
	"baseline_end_at" timestamp,
	"planned_start_at" timestamp,
	"planned_end_at" timestamp,
	"actual_start_at" timestamp,
	"actual_end_at" timestamp,
	"has_impediment" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "eap_tasks_progress_percent_chk" CHECK ("eap_tasks"."progress_percent" >= 0 AND "eap_tasks"."progress_percent" <= 100),
	CONSTRAINT "eap_tasks_concluded_progress_chk" CHECK ("eap_tasks"."status" <> 'CONCLUIDA' OR "eap_tasks"."progress_percent" = 100),
	CONSTRAINT "eap_tasks_weight_chk" CHECK ("eap_tasks"."weight" >= 1),
	CONSTRAINT "eap_tasks_planned_dates_chk" CHECK ("eap_tasks"."planned_end_at" IS NULL OR "eap_tasks"."planned_start_at" IS NULL OR "eap_tasks"."planned_end_at" >= "eap_tasks"."planned_start_at"),
	CONSTRAINT "eap_tasks_baseline_dates_chk" CHECK ("eap_tasks"."baseline_end_at" IS NULL OR "eap_tasks"."baseline_start_at" IS NULL OR "eap_tasks"."baseline_end_at" >= "eap_tasks"."baseline_start_at"),
	CONSTRAINT "eap_tasks_actual_dates_chk" CHECK ("eap_tasks"."actual_end_at" IS NULL OR ("eap_tasks"."actual_start_at" IS NOT NULL AND "eap_tasks"."actual_end_at" >= "eap_tasks"."actual_start_at"))
);
--> statement-breakpoint
ALTER TABLE "eap_audit_logs" ADD CONSTRAINT "eap_audit_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_audit_logs" ADD CONSTRAINT "eap_audit_logs_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD CONSTRAINT "eap_evidences_task_id_eap_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."eap_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD CONSTRAINT "eap_evidences_milestone_id_eap_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."eap_milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD CONSTRAINT "eap_evidences_schedule_request_id_eap_schedule_requests_id_fk" FOREIGN KEY ("schedule_request_id") REFERENCES "public"."eap_schedule_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD CONSTRAINT "eap_evidences_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_impediments" ADD CONSTRAINT "eap_impediments_task_id_eap_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."eap_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_impediments" ADD CONSTRAINT "eap_impediments_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_impediments" ADD CONSTRAINT "eap_impediments_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_milestones" ADD CONSTRAINT "eap_milestones_phase_id_eap_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."eap_phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_milestones" ADD CONSTRAINT "eap_milestones_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_milestones" ADD CONSTRAINT "eap_milestones_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_milestones" ADD CONSTRAINT "eap_milestones_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_phases" ADD CONSTRAINT "eap_phases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_phases" ADD CONSTRAINT "eap_phases_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_phases" ADD CONSTRAINT "eap_phases_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_schedule_changes" ADD CONSTRAINT "eap_schedule_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_schedule_changes" ADD CONSTRAINT "eap_schedule_changes_request_id_eap_schedule_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."eap_schedule_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_schedule_changes" ADD CONSTRAINT "eap_schedule_changes_phase_id_eap_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."eap_phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_schedule_changes" ADD CONSTRAINT "eap_schedule_changes_task_id_eap_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."eap_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_schedule_changes" ADD CONSTRAINT "eap_schedule_changes_milestone_id_eap_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."eap_milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_schedule_changes" ADD CONSTRAINT "eap_schedule_changes_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_schedule_requests" ADD CONSTRAINT "eap_schedule_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_schedule_requests" ADD CONSTRAINT "eap_schedule_requests_phase_id_eap_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."eap_phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_schedule_requests" ADD CONSTRAINT "eap_schedule_requests_task_id_eap_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."eap_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_schedule_requests" ADD CONSTRAINT "eap_schedule_requests_milestone_id_eap_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."eap_milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_schedule_requests" ADD CONSTRAINT "eap_schedule_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_schedule_requests" ADD CONSTRAINT "eap_schedule_requests_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_tasks" ADD CONSTRAINT "eap_tasks_phase_id_eap_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."eap_phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_tasks" ADD CONSTRAINT "eap_tasks_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_tasks" ADD CONSTRAINT "eap_tasks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_tasks" ADD CONSTRAINT "eap_tasks_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eap_audit_logs_project_id_idx" ON "eap_audit_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "eap_audit_logs_entity_idx" ON "eap_audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "eap_audit_logs_created_at_idx" ON "eap_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "eap_evidences_task_id_idx" ON "eap_evidences" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "eap_evidences_milestone_id_idx" ON "eap_evidences" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "eap_evidences_schedule_request_id_idx" ON "eap_evidences" USING btree ("schedule_request_id");--> statement-breakpoint
CREATE INDEX "eap_impediments_task_id_idx" ON "eap_impediments" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eap_impediments_open_task_idx" ON "eap_impediments" USING btree ("task_id") WHERE "eap_impediments"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "eap_milestones_phase_id_idx" ON "eap_milestones" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "eap_milestones_status_planned_at_idx" ON "eap_milestones" USING btree ("status","planned_at");--> statement-breakpoint
CREATE INDEX "eap_phases_project_id_idx" ON "eap_phases" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "eap_schedule_changes_project_id_idx" ON "eap_schedule_changes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "eap_schedule_changes_request_id_idx" ON "eap_schedule_changes" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "eap_schedule_changes_phase_id_idx" ON "eap_schedule_changes" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "eap_schedule_changes_task_id_idx" ON "eap_schedule_changes" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "eap_schedule_changes_milestone_id_idx" ON "eap_schedule_changes" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "eap_schedule_requests_project_status_idx" ON "eap_schedule_requests" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "eap_schedule_requests_phase_id_idx" ON "eap_schedule_requests" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "eap_schedule_requests_task_id_idx" ON "eap_schedule_requests" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "eap_schedule_requests_milestone_id_idx" ON "eap_schedule_requests" USING btree ("milestone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eap_schedule_requests_pending_phase_field_idx" ON "eap_schedule_requests" USING btree ("phase_id","field") WHERE "eap_schedule_requests"."status" = 'PENDENTE' AND "eap_schedule_requests"."phase_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "eap_schedule_requests_pending_task_field_idx" ON "eap_schedule_requests" USING btree ("task_id","field") WHERE "eap_schedule_requests"."status" = 'PENDENTE' AND "eap_schedule_requests"."task_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "eap_schedule_requests_pending_milestone_field_idx" ON "eap_schedule_requests" USING btree ("milestone_id","field") WHERE "eap_schedule_requests"."status" = 'PENDENTE' AND "eap_schedule_requests"."milestone_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "eap_tasks_phase_id_idx" ON "eap_tasks" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "eap_tasks_assignee_id_idx" ON "eap_tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "eap_tasks_status_planned_end_idx" ON "eap_tasks" USING btree ("status","planned_end_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION eap_prevent_baseline_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'eap_milestones' THEN
    IF OLD.baseline_at IS DISTINCT FROM NEW.baseline_at THEN
      RAISE EXCEPTION 'A linha de base da EAP é imutável após a criação.'
        USING ERRCODE = '23000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.baseline_start_at IS DISTINCT FROM NEW.baseline_start_at
     OR OLD.baseline_end_at IS DISTINCT FROM NEW.baseline_end_at THEN
    RAISE EXCEPTION 'A linha de base da EAP é imutável após a criação.'
      USING ERRCODE = '23000';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER eap_phases_baseline_immutable
  BEFORE UPDATE ON eap_phases
  FOR EACH ROW
  EXECUTE FUNCTION eap_prevent_baseline_mutation();--> statement-breakpoint
CREATE TRIGGER eap_tasks_baseline_immutable
  BEFORE UPDATE ON eap_tasks
  FOR EACH ROW
  EXECUTE FUNCTION eap_prevent_baseline_mutation();--> statement-breakpoint
CREATE TRIGGER eap_milestones_baseline_immutable
  BEFORE UPDATE ON eap_milestones
  FOR EACH ROW
  EXECUTE FUNCTION eap_prevent_baseline_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION eap_schedule_request_matches_entity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entity_project_id text;
BEGIN
  IF NEW.phase_id IS NOT NULL THEN
    SELECT project_id INTO entity_project_id
    FROM eap_phases
    WHERE id = NEW.phase_id;
  ELSIF NEW.task_id IS NOT NULL THEN
    SELECT p.project_id INTO entity_project_id
    FROM eap_tasks t
    INNER JOIN eap_phases p ON p.id = t.phase_id
    WHERE t.id = NEW.task_id;
  ELSIF NEW.milestone_id IS NOT NULL THEN
    SELECT p.project_id INTO entity_project_id
    FROM eap_milestones m
    INNER JOIN eap_phases p ON p.id = m.phase_id
    WHERE m.id = NEW.milestone_id;
  END IF;

  IF entity_project_id IS NULL OR entity_project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'A solicitação de prazo deve referenciar uma entidade do mesmo projeto.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER eap_schedule_requests_entity_project
  BEFORE INSERT OR UPDATE ON eap_schedule_requests
  FOR EACH ROW
  EXECUTE FUNCTION eap_schedule_request_matches_entity();--> statement-breakpoint
CREATE OR REPLACE FUNCTION eap_schedule_change_matches_request()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  req record;
BEGIN
  SELECT project_id, phase_id, task_id, milestone_id, field
  INTO STRICT req
  FROM eap_schedule_requests
  WHERE id = NEW.request_id;

  IF NEW.project_id IS DISTINCT FROM req.project_id
     OR NEW.phase_id IS DISTINCT FROM req.phase_id
     OR NEW.task_id IS DISTINCT FROM req.task_id
     OR NEW.milestone_id IS DISTINCT FROM req.milestone_id
     OR NEW.field IS DISTINCT FROM req.field THEN
    RAISE EXCEPTION 'A alteração de prazo deve referenciar a mesma entidade, campo e projeto da solicitação.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER eap_schedule_changes_matches_request
  BEFORE INSERT OR UPDATE ON eap_schedule_changes
  FOR EACH ROW
  EXECUTE FUNCTION eap_schedule_change_matches_request();