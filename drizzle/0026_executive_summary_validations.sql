ALTER TYPE "public"."eap_audit_action" ADD VALUE 'EXECUTIVE_SUMMARY_VALIDATE';--> statement-breakpoint
CREATE TABLE "project_executive_summary_validations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"cycle_start" date NOT NULL,
	"cycle_end" date NOT NULL,
	"kind" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"fingerprint" text NOT NULL,
	"unchanged" boolean DEFAULT false NOT NULL,
	"observation" text,
	"validated_by" text NOT NULL,
	"validated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_executive_summary_validations_kind_chk" CHECK ("project_executive_summary_validations"."kind" IN ('REGULAR', 'EXTRAORDINARY')),
	CONSTRAINT "project_executive_summary_validations_cycle_chk" CHECK ("project_executive_summary_validations"."cycle_end" = "project_executive_summary_validations"."cycle_start" + 6),
	CONSTRAINT "project_executive_summary_validations_observation_chk" CHECK (("project_executive_summary_validations"."kind" = 'REGULAR' OR ("project_executive_summary_validations"."observation" IS NOT NULL AND btrim("project_executive_summary_validations"."observation") <> '')) AND ("project_executive_summary_validations"."observation" IS NULL OR char_length("project_executive_summary_validations"."observation") <= 2000))
);
--> statement-breakpoint
ALTER TABLE "project_executive_summary_validations" ADD CONSTRAINT "project_executive_summary_validations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_executive_summary_validations" ADD CONSTRAINT "project_executive_summary_validations_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_executive_summary_validations_project_idx" ON "project_executive_summary_validations" USING btree ("project_id","validated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_executive_summary_validations_regular_cycle_uq" ON "project_executive_summary_validations" USING btree ("project_id","cycle_start") WHERE "project_executive_summary_validations"."kind" = 'REGULAR';
--> statement-breakpoint
-- Histórico imutável: UPDATE, DELETE e TRUNCATE são bloqueados no banco, independentemente da API.
-- Manutenção excepcional e controlada (DBA, com registro): dentro de uma transação, executar
--   SET LOCAL app.allow_executive_summary_maintenance = 'on';
-- antes da correção. A aplicação nunca define essa configuração.
CREATE FUNCTION "project_executive_summary_validations_immutable"() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_executive_summary_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'O histórico de validações do resumo executivo é imutável.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "project_executive_summary_validations_immutable_row"
  BEFORE UPDATE OR DELETE ON "project_executive_summary_validations"
  FOR EACH ROW EXECUTE FUNCTION "project_executive_summary_validations_immutable"();
--> statement-breakpoint
CREATE TRIGGER "project_executive_summary_validations_immutable_truncate"
  BEFORE TRUNCATE ON "project_executive_summary_validations"
  FOR EACH STATEMENT EXECUTE FUNCTION "project_executive_summary_validations_immutable"();
