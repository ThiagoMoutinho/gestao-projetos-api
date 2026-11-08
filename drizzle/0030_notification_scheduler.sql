CREATE TABLE "notification_scheduler_instances" (
	"instance_id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"hostname" text NOT NULL,
	"pid" integer NOT NULL,
	"interval_seconds" integer NOT NULL,
	"started_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"stopped_at" timestamp,
	"stop_reason" text,
	CONSTRAINT "notification_scheduler_instances_mode_chk" CHECK ("notification_scheduler_instances"."mode" IN ('PLUGIN', 'WORKER'))
);
--> statement-breakpoint
CREATE TABLE "notification_scheduler_state" (
	"id" text PRIMARY KEY NOT NULL,
	"next_due_at" timestamp,
	"claim_token" text,
	"claimed_by" text,
	"claimed_until" timestamp,
	"last_started_at" timestamp,
	"last_finished_at" timestamp,
	"last_success_at" timestamp,
	"last_status" text,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"consecutive_successes" integer DEFAULT 0 NOT NULL,
	"last_run_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_scheduler_state_singleton_chk" CHECK ("notification_scheduler_state"."id" = 'GLOBAL'),
	CONSTRAINT "notification_scheduler_state_status_chk" CHECK ("notification_scheduler_state"."last_status" IS NULL OR "notification_scheduler_state"."last_status" IN ('IDLE_ACTIVATION_OFF', 'IDLE_NOTHING_TO_DO', 'TECHNICAL_ONLY', 'RAN', 'FAILED', 'ABORTED_LEASE_LOST', 'SKIPPED_LOCKED', 'SKIPPED_STANDBY')),
	CONSTRAINT "notification_scheduler_state_counters_chk" CHECK ("notification_scheduler_state"."consecutive_failures" >= 0 AND "notification_scheduler_state"."consecutive_successes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "notification_issues" DROP CONSTRAINT "notification_issues_kind_chk";--> statement-breakpoint
ALTER TABLE "notification_runs" DROP CONSTRAINT "notification_runs_origin_chk";--> statement-breakpoint
ALTER TABLE "notification_scheduler_state" ADD CONSTRAINT "notification_scheduler_state_last_run_id_notification_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."notification_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_scheduler_instances_seen_idx" ON "notification_scheduler_instances" USING btree ("last_seen_at");--> statement-breakpoint
ALTER TABLE "notification_issues" ADD CONSTRAINT "notification_issues_kind_chk" CHECK ("notification_issues"."kind" IN ('CALENDAR_NOT_VALIDATED', 'NO_RECIPIENT', 'RECIPIENT_INACTIVE', 'RULE_MISSING', 'SCHEDULER_FAILURE'));--> statement-breakpoint
ALTER TABLE "notification_runs" ADD CONSTRAINT "notification_runs_origin_chk" CHECK ("notification_runs"."origin" IN ('CLI', 'API', 'SCHEDULER'));
--> statement-breakpoint
-- Linha única do estado do agendador, criada vazia (sem reserva, sem execução registrada).
INSERT INTO "notification_scheduler_state" ("id") VALUES ('GLOBAL');
--> statement-breakpoint
-- O estado do agendador nunca é excluído nem truncado (reaproveita a função de proteção da migration 0029).
-- Manutenção excepcional e controlada (DBA, com registro): SET LOCAL app.allow_notification_maintenance = 'on';
CREATE TRIGGER "notification_scheduler_state_no_delete_row"
  BEFORE DELETE ON "notification_scheduler_state"
  FOR EACH ROW EXECUTE FUNCTION "notification_history_immutable"();
--> statement-breakpoint
CREATE TRIGGER "notification_scheduler_state_no_truncate"
  BEFORE TRUNCATE ON "notification_scheduler_state"
  FOR EACH STATEMENT EXECUTE FUNCTION "notification_history_immutable"();
