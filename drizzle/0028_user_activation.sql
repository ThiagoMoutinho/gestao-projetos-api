CREATE TABLE "user_activation_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"sessions_revoked" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_activation_changes_action_chk" CHECK ("user_activation_changes"."action" IN ('ACTIVATE', 'DEACTIVATE')),
	CONSTRAINT "user_activation_changes_reason_chk" CHECK (length(btrim("user_activation_changes"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deactivated_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deactivated_by" text;--> statement-breakpoint
ALTER TABLE "user_activation_changes" ADD CONSTRAINT "user_activation_changes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activation_changes" ADD CONSTRAINT "user_activation_changes_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_activation_changes_user_idx" ON "user_activation_changes" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_deactivated_by_user_id_fk" FOREIGN KEY ("deactivated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_inactive_chk" CHECK ("user"."is_active" OR "user"."deactivated_at" IS NOT NULL);
--> statement-breakpoint
-- Histórico de ativação/desativação de usuários só de inserção: UPDATE, DELETE e TRUNCATE são bloqueados.
-- Manutenção excepcional e controlada (DBA, com registro): dentro de uma transação, executar
--   SET LOCAL app.allow_user_admin_maintenance = 'on';
-- antes da correção. A aplicação nunca define essa configuração.
CREATE FUNCTION "user_activation_changes_immutable"() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_user_admin_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'O histórico de ativação e desativação de usuários é imutável.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "user_activation_changes_immutable_row"
  BEFORE UPDATE OR DELETE ON "user_activation_changes"
  FOR EACH ROW EXECUTE FUNCTION "user_activation_changes_immutable"();
--> statement-breakpoint
CREATE TRIGGER "user_activation_changes_immutable_truncate"
  BEFORE TRUNCATE ON "user_activation_changes"
  FOR EACH STATEMENT EXECUTE FUNCTION "user_activation_changes_immutable"();
