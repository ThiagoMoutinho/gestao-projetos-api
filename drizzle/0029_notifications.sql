CREATE TABLE "executive_followup_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"cycle_start" date NOT NULL,
	"sequence_start" date,
	"due_date" date NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"followup_snapshot" jsonb NOT NULL,
	"run_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolution_reason" text,
	"resolved_validation_id" text,
	"resolved_run_id" text,
	CONSTRAINT "executive_followup_notifications_kind_chk" CHECK ("executive_followup_notifications"."kind" IN ('PREVENTIVE', 'OVERDUE', 'ESCALATION')),
	CONSTRAINT "executive_followup_notifications_sequence_chk" CHECK ("executive_followup_notifications"."kind" <> 'ESCALATION' OR "executive_followup_notifications"."sequence_start" IS NOT NULL),
	CONSTRAINT "executive_followup_notifications_resolution_chk" CHECK (("executive_followup_notifications"."resolved_at" IS NULL) = ("executive_followup_notifications"."resolution_reason" IS NULL)),
	CONSTRAINT "executive_followup_notifications_reason_chk" CHECK ("executive_followup_notifications"."resolution_reason" IS NULL OR "executive_followup_notifications"."resolution_reason" IN ('VALIDATED', 'PROJECT_SUSPENDED', 'PROJECT_CONCLUDED', 'CYCLE_EXPIRED')),
	CONSTRAINT "executive_followup_notifications_validated_chk" CHECK ("executive_followup_notifications"."resolution_reason" IS DISTINCT FROM 'VALIDATED' OR "executive_followup_notifications"."resolved_validation_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"user_id" text NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_role" text NOT NULL,
	"visibility" text NOT NULL,
	"delivered_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp,
	CONSTRAINT "notification_deliveries_visibility_chk" CHECK ("notification_deliveries"."visibility" IN ('TO', 'CC'))
);
--> statement-breakpoint
CREATE TABLE "notification_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"year" integer,
	"details" jsonb NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"resolved_at" timestamp,
	"resolution" text,
	"resolved_by" text,
	"resolution_note" text,
	CONSTRAINT "notification_issues_kind_chk" CHECK ("notification_issues"."kind" IN ('CALENDAR_NOT_VALIDATED', 'NO_RECIPIENT', 'RECIPIENT_INACTIVE', 'RULE_MISSING')),
	CONSTRAINT "notification_issues_resolution_chk" CHECK (("notification_issues"."resolved_at" IS NULL) = ("notification_issues"."resolution" IS NULL)),
	CONSTRAINT "notification_issues_resolution_kind_chk" CHECK ("notification_issues"."resolution" IS NULL OR "notification_issues"."resolution" IN ('AUTO', 'MANUAL')),
	CONSTRAINT "notification_issues_manual_chk" CHECK ("notification_issues"."resolution" IS DISTINCT FROM 'MANUAL' OR ("notification_issues"."resolved_by" IS NOT NULL AND length(btrim("notification_issues"."resolution_note")) > 0))
);
--> statement-breakpoint
CREATE TABLE "notification_recipient_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"role" text,
	"user_id" text,
	"visibility" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_recipient_rules_kind_chk" CHECK ("notification_recipient_rules"."kind" IN ('PREVENTIVE', 'OVERDUE', 'ESCALATION')),
	CONSTRAINT "notification_recipient_rules_source_chk" CHECK ("notification_recipient_rules"."source" IN ('ROLE', 'USER')),
	CONSTRAINT "notification_recipient_rules_visibility_chk" CHECK ("notification_recipient_rules"."visibility" IN ('TO', 'CC')),
	CONSTRAINT "notification_recipient_rules_role_chk" CHECK ("notification_recipient_rules"."role" IS NULL OR "notification_recipient_rules"."role" IN ('PMO', 'ADMIN')),
	CONSTRAINT "notification_recipient_rules_target_chk" CHECK (("notification_recipient_rules"."source" = 'ROLE' AND "notification_recipient_rules"."role" IS NOT NULL AND "notification_recipient_rules"."user_id" IS NULL) OR ("notification_recipient_rules"."source" = 'USER' AND "notification_recipient_rules"."user_id" IS NOT NULL AND "notification_recipient_rules"."role" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "notification_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"origin" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"actor_id" text,
	"as_of" timestamp NOT NULL,
	"simulated_cutoff" date,
	"evaluated_projects" integer DEFAULT 0 NOT NULL,
	"created_notifications" integer DEFAULT 0 NOT NULL,
	"resolved_notifications" integer DEFAULT 0 NOT NULL,
	"issues_seen" integer DEFAULT 0 NOT NULL,
	"summary" jsonb,
	"error" text,
	CONSTRAINT "notification_runs_mode_chk" CHECK ("notification_runs"."mode" IN ('DRY_RUN', 'ACTIVE')),
	CONSTRAINT "notification_runs_origin_chk" CHECK ("notification_runs"."origin" IN ('CLI', 'API')),
	CONSTRAINT "notification_runs_status_chk" CHECK ("notification_runs"."status" IN ('RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED_LOCKED'))
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"activation_enabled" boolean DEFAULT false NOT NULL,
	"activation_cutoff" date,
	"activated_at" timestamp,
	"activated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_singleton_chk" CHECK ("notification_settings"."id" = 'GLOBAL'),
	CONSTRAINT "notification_settings_enabled_chk" CHECK (NOT "notification_settings"."activation_enabled" OR ("notification_settings"."activation_cutoff" IS NOT NULL AND "notification_settings"."activated_at" IS NOT NULL AND "notification_settings"."activated_by" IS NOT NULL)),
	CONSTRAINT "notification_settings_cutoff_thursday_chk" CHECK ("notification_settings"."activation_cutoff" IS NULL OR EXTRACT(DOW FROM "notification_settings"."activation_cutoff") = 4)
);
--> statement-breakpoint
CREATE TABLE "notification_settings_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"justification" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_changes_action_chk" CHECK ("notification_settings_changes"."action" IN ('ACTIVATE', 'DEACTIVATE', 'RULE_CREATE', 'RULE_UPDATE')),
	CONSTRAINT "notification_settings_changes_justification_chk" CHECK (length(btrim("notification_settings_changes"."justification")) > 0)
);
--> statement-breakpoint
ALTER TABLE "executive_followup_notifications" ADD CONSTRAINT "executive_followup_notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_followup_notifications" ADD CONSTRAINT "executive_followup_notifications_run_id_notification_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."notification_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_followup_notifications" ADD CONSTRAINT "executive_followup_notifications_resolved_validation_id_project_executive_summary_validations_id_fk" FOREIGN KEY ("resolved_validation_id") REFERENCES "public"."project_executive_summary_validations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_followup_notifications" ADD CONSTRAINT "executive_followup_notifications_resolved_run_id_notification_runs_id_fk" FOREIGN KEY ("resolved_run_id") REFERENCES "public"."notification_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_executive_followup_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."executive_followup_notifications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_issues" ADD CONSTRAINT "notification_issues_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipient_rules" ADD CONSTRAINT "notification_recipient_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipient_rules" ADD CONSTRAINT "notification_recipient_rules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipient_rules" ADD CONSTRAINT "notification_recipient_rules_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_runs" ADD CONSTRAINT "notification_runs_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_activated_by_user_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings_changes" ADD CONSTRAINT "notification_settings_changes_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "executive_followup_notifications_dedupe_uq" ON "executive_followup_notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "executive_followup_notifications_project_idx" ON "executive_followup_notifications" USING btree ("project_id","kind","cycle_start");--> statement-breakpoint
CREATE INDEX "executive_followup_notifications_open_idx" ON "executive_followup_notifications" USING btree ("project_id") WHERE "executive_followup_notifications"."resolved_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_recipient_uq" ON "notification_deliveries" USING btree ("notification_id","user_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_inbox_idx" ON "notification_deliveries" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_issues_open_uq" ON "notification_issues" USING btree ("dedupe_key") WHERE "notification_issues"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notification_issues_open_idx" ON "notification_issues" USING btree ("kind") WHERE "notification_issues"."resolved_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipient_rules_target_uq" ON "notification_recipient_rules" USING btree ("kind","source",coalesce("role", ''),coalesce("user_id", ''),"visibility");--> statement-breakpoint
CREATE INDEX "notification_runs_started_idx" ON "notification_runs" USING btree ("started_at");
--> statement-breakpoint
-- Linha única de configuração, criada desligada. Ativar exige corte (quinta-feira), data, responsável e histórico.
INSERT INTO "notification_settings" ("id", "activation_enabled") VALUES ('GLOBAL', false);
--> statement-breakpoint
-- Manutenção excepcional e controlada (DBA, com registro): dentro de uma transação, executar
--   SET LOCAL app.allow_notification_maintenance = 'on';
-- antes da correção. A aplicação nunca define essa configuração.
-- Notificações reais, entregas e ocorrências só podem ser inseridas com a ativação ligada.
CREATE FUNCTION "notification_activation_guard"() RETURNS trigger AS $$
DECLARE
  s record;
BEGIN
  SELECT "activation_enabled" INTO s FROM "notification_settings" WHERE "id" = 'GLOBAL';
  IF NOT FOUND OR NOT s."activation_enabled" THEN
    RAISE EXCEPTION 'As notificações estão desativadas: nada é gerado antes da ativação oficial.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Sem cobrança retroativa: nenhum aviso agendado antes da ativação nem de ciclo anterior ao corte.
CREATE FUNCTION "notification_no_retroactive_guard"() RETURNS trigger AS $$
DECLARE
  s record;
BEGIN
  SELECT "activation_enabled", "activation_cutoff", "activated_at" INTO s FROM "notification_settings" WHERE "id" = 'GLOBAL';
  IF NOT FOUND OR NOT s."activation_enabled" THEN
    RAISE EXCEPTION 'As notificações estão desativadas: nada é gerado antes da ativação oficial.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."scheduled_for" < s."activated_at" OR NEW."cycle_start" < s."activation_cutoff" THEN
    RAISE EXCEPTION 'Notificação retroativa: anterior à ativação ou a ciclo anterior ao corte.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "executive_followup_notifications_guard"
  BEFORE INSERT ON "executive_followup_notifications"
  FOR EACH ROW EXECUTE FUNCTION "notification_no_retroactive_guard"();
--> statement-breakpoint
CREATE TRIGGER "notification_deliveries_guard"
  BEFORE INSERT ON "notification_deliveries"
  FOR EACH ROW EXECUTE FUNCTION "notification_activation_guard"();
--> statement-breakpoint
CREATE TRIGGER "notification_issues_guard"
  BEFORE INSERT ON "notification_issues"
  FOR EACH ROW EXECUTE FUNCTION "notification_activation_guard"();
--> statement-breakpoint
-- O conteúdo da notificação é imutável: só a resolução pode ser registrada, uma única vez.
CREATE FUNCTION "executive_followup_notifications_immutable"() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_notification_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD."resolved_at" IS NULL
     AND (to_jsonb(NEW) - 'resolved_at' - 'resolution_reason' - 'resolved_validation_id' - 'resolved_run_id')
         IS NOT DISTINCT FROM (to_jsonb(OLD) - 'resolved_at' - 'resolution_reason' - 'resolved_validation_id' - 'resolved_run_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'As notificações são imutáveis: só a resolução pode ser registrada (uma vez) e nada é excluído.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "executive_followup_notifications_immutable_row"
  BEFORE UPDATE OR DELETE ON "executive_followup_notifications"
  FOR EACH ROW EXECUTE FUNCTION "executive_followup_notifications_immutable"();
--> statement-breakpoint
CREATE TRIGGER "executive_followup_notifications_immutable_truncate"
  BEFORE TRUNCATE ON "executive_followup_notifications"
  FOR EACH STATEMENT EXECUTE FUNCTION "executive_followup_notifications_immutable"();
--> statement-breakpoint
-- Na entrega só a leitura pode ser registrada, uma única vez.
CREATE FUNCTION "notification_deliveries_immutable"() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_notification_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD."read_at" IS NULL
     AND (to_jsonb(NEW) - 'read_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'read_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'As entregas são imutáveis: só a leitura pode ser registrada (uma vez) e nada é excluído.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "notification_deliveries_immutable_row"
  BEFORE UPDATE OR DELETE ON "notification_deliveries"
  FOR EACH ROW EXECUTE FUNCTION "notification_deliveries_immutable"();
--> statement-breakpoint
CREATE TRIGGER "notification_deliveries_immutable_truncate"
  BEFORE TRUNCATE ON "notification_deliveries"
  FOR EACH STATEMENT EXECUTE FUNCTION "notification_deliveries_immutable"();
--> statement-breakpoint
-- Histórico de configuração só de inserção; configuração, regras, ocorrências e execuções nunca são excluídas.
CREATE FUNCTION "notification_history_immutable"() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_notification_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Registro histórico de notificações: alteração e exclusão não são permitidas.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "notification_settings_changes_immutable_row"
  BEFORE UPDATE OR DELETE ON "notification_settings_changes"
  FOR EACH ROW EXECUTE FUNCTION "notification_history_immutable"();
--> statement-breakpoint
CREATE TRIGGER "notification_settings_changes_immutable_truncate"
  BEFORE TRUNCATE ON "notification_settings_changes"
  FOR EACH STATEMENT EXECUTE FUNCTION "notification_history_immutable"();
--> statement-breakpoint
CREATE TRIGGER "notification_settings_no_delete_row"
  BEFORE DELETE ON "notification_settings"
  FOR EACH ROW EXECUTE FUNCTION "notification_history_immutable"();
--> statement-breakpoint
CREATE TRIGGER "notification_settings_no_truncate"
  BEFORE TRUNCATE ON "notification_settings"
  FOR EACH STATEMENT EXECUTE FUNCTION "notification_history_immutable"();
--> statement-breakpoint
CREATE TRIGGER "notification_recipient_rules_no_delete_row"
  BEFORE DELETE ON "notification_recipient_rules"
  FOR EACH ROW EXECUTE FUNCTION "notification_history_immutable"();
--> statement-breakpoint
CREATE TRIGGER "notification_recipient_rules_no_truncate"
  BEFORE TRUNCATE ON "notification_recipient_rules"
  FOR EACH STATEMENT EXECUTE FUNCTION "notification_history_immutable"();
--> statement-breakpoint
CREATE TRIGGER "notification_issues_no_delete_row"
  BEFORE DELETE ON "notification_issues"
  FOR EACH ROW EXECUTE FUNCTION "notification_history_immutable"();
--> statement-breakpoint
CREATE TRIGGER "notification_issues_no_truncate"
  BEFORE TRUNCATE ON "notification_issues"
  FOR EACH STATEMENT EXECUTE FUNCTION "notification_history_immutable"();
--> statement-breakpoint
CREATE TRIGGER "notification_runs_no_delete_row"
  BEFORE DELETE ON "notification_runs"
  FOR EACH ROW EXECUTE FUNCTION "notification_history_immutable"();
--> statement-breakpoint
CREATE TRIGGER "notification_runs_no_truncate"
  BEFORE TRUNCATE ON "notification_runs"
  FOR EACH STATEMENT EXECUTE FUNCTION "notification_history_immutable"();
