CREATE TABLE "business_calendar_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"day_id" text,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"note" text,
	"actor_id" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "business_calendar_changes_action_chk" CHECK ("business_calendar_changes"."action" IN ('DAY_CREATE', 'DAY_UPDATE', 'DAY_DELETE', 'YEAR_VALIDATE', 'YEAR_REVERT_TO_DRAFT'))
);
--> statement-breakpoint
CREATE TABLE "business_calendar_days" (
	"id" text PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"day" date NOT NULL,
	"scope" text NOT NULL,
	"kind" text NOT NULL,
	"observed" boolean NOT NULL,
	"description" text NOT NULL,
	"legal_basis" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "business_calendar_days_scope_chk" CHECK ("business_calendar_days"."scope" IN ('NACIONAL', 'ESTADUAL_PA', 'MUNICIPAL_BELEM', 'INSTITUCIONAL')),
	CONSTRAINT "business_calendar_days_kind_chk" CHECK ("business_calendar_days"."kind" IN ('FERIADO', 'PONTO_FACULTATIVO', 'NAO_UTIL_INSTITUCIONAL', 'EXPEDIENTE_EXCECAO')),
	CONSTRAINT "business_calendar_days_institutional_chk" CHECK ("business_calendar_days"."kind" NOT IN ('NAO_UTIL_INSTITUCIONAL', 'EXPEDIENTE_EXCECAO') OR "business_calendar_days"."scope" = 'INSTITUCIONAL'),
	CONSTRAINT "business_calendar_days_year_chk" CHECK ("business_calendar_days"."year" = EXTRACT(YEAR FROM "business_calendar_days"."day")::int),
	CONSTRAINT "business_calendar_days_legal_basis_chk" CHECK ("business_calendar_days"."scope" = 'NACIONAL' OR ("business_calendar_days"."legal_basis" IS NOT NULL AND btrim("business_calendar_days"."legal_basis") <> ''))
);
--> statement-breakpoint
CREATE TABLE "business_calendar_years" (
	"year" integer PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"national_checked" boolean DEFAULT false NOT NULL,
	"state_checked" boolean DEFAULT false NOT NULL,
	"municipal_checked" boolean DEFAULT false NOT NULL,
	"source_note" text,
	"validated_by" text,
	"validated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "business_calendar_years_status_chk" CHECK ("business_calendar_years"."status" IN ('DRAFT', 'VALIDATED')),
	CONSTRAINT "business_calendar_years_validated_chk" CHECK ("business_calendar_years"."status" = 'DRAFT' OR ("business_calendar_years"."validated_by" IS NOT NULL AND "business_calendar_years"."validated_at" IS NOT NULL AND "business_calendar_years"."national_checked" AND "business_calendar_years"."state_checked" AND "business_calendar_years"."municipal_checked")),
	CONSTRAINT "business_calendar_years_year_chk" CHECK ("business_calendar_years"."year" BETWEEN 2000 AND 2200)
);
--> statement-breakpoint
ALTER TABLE "business_calendar_changes" ADD CONSTRAINT "business_calendar_changes_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_calendar_days" ADD CONSTRAINT "business_calendar_days_year_business_calendar_years_year_fk" FOREIGN KEY ("year") REFERENCES "public"."business_calendar_years"("year") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_calendar_days" ADD CONSTRAINT "business_calendar_days_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_calendar_days" ADD CONSTRAINT "business_calendar_days_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_calendar_years" ADD CONSTRAINT "business_calendar_years_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_calendar_changes_year_idx" ON "business_calendar_changes" USING btree ("year","at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_calendar_days_day_scope_kind_uq" ON "business_calendar_days" USING btree ("day","scope","kind");--> statement-breakpoint
CREATE INDEX "business_calendar_days_year_idx" ON "business_calendar_days" USING btree ("year","day");

--> statement-breakpoint
-- Qualquer alteração nos dias de um ano validado devolve o ano a rascunho (garantido no banco, independente da API):
-- a validação do ADMIN deixa de valer e uma nova é necessária.
CREATE FUNCTION "business_calendar_days_revert_year"() RETURNS trigger AS $$
BEGIN
  UPDATE "business_calendar_years"
     SET "status" = 'DRAFT',
         "validated_by" = NULL,
         "validated_at" = NULL,
         "national_checked" = false,
         "state_checked" = false,
         "municipal_checked" = false,
         "updated_at" = now()
   WHERE "status" = 'VALIDATED'
     AND "year" IN (COALESCE(NEW."year", OLD."year"), COALESCE(OLD."year", NEW."year"));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "business_calendar_days_revert_year_trg"
  AFTER INSERT OR UPDATE OR DELETE ON "business_calendar_days"
  FOR EACH ROW EXECUTE FUNCTION "business_calendar_days_revert_year"();
--> statement-breakpoint
-- Histórico do calendário só de inserção: UPDATE, DELETE e TRUNCATE são bloqueados.
-- Manutenção excepcional e controlada (DBA, com registro): dentro de uma transação, executar
--   SET LOCAL app.allow_calendar_maintenance = 'on';
-- antes da correção. A aplicação nunca define essa configuração.
CREATE FUNCTION "business_calendar_changes_immutable"() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_calendar_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'O histórico de alterações do calendário institucional é imutável.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "business_calendar_changes_immutable_row"
  BEFORE UPDATE OR DELETE ON "business_calendar_changes"
  FOR EACH ROW EXECUTE FUNCTION "business_calendar_changes_immutable"();
--> statement-breakpoint
CREATE TRIGGER "business_calendar_changes_immutable_truncate"
  BEFORE TRUNCATE ON "business_calendar_changes"
  FOR EACH STATEMENT EXECUTE FUNCTION "business_calendar_changes_immutable"();
