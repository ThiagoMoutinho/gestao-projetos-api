CREATE TYPE "public"."eap_milestone_delivery_status" AS ENUM('EM_ANALISE', 'ACEITA', 'AJUSTES_SOLICITADOS', 'REJEITADA');--> statement-breakpoint
ALTER TYPE "public"."eap_milestone_status" ADD VALUE 'AJUSTES_SOLICITADOS';--> statement-breakpoint
CREATE TABLE "eap_milestone_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"milestone_id" text NOT NULL,
	"round" integer NOT NULL,
	"legacy" boolean DEFAULT false NOT NULL,
	"status" "eap_milestone_delivery_status" DEFAULT 'EM_ANALISE' NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp,
	"note" text,
	"decided_by" text,
	"decided_at" timestamp,
	"decision_note" text,
	"adjustments" text,
	"resubmission_authorized_by" text,
	"resubmission_authorized_at" timestamp,
	"resubmission_note" text,
	CONSTRAINT "eap_milestone_deliveries_round_unique" UNIQUE("milestone_id","round"),
	CONSTRAINT "eap_milestone_deliveries_round_chk" CHECK ("eap_milestone_deliveries"."round" >= 1),
	CONSTRAINT "eap_milestone_deliveries_submitted_at_chk" CHECK ("eap_milestone_deliveries"."legacy" OR "eap_milestone_deliveries"."submitted_at" IS NOT NULL),
	CONSTRAINT "eap_milestone_deliveries_decision_chk" CHECK ((
        (
          "eap_milestone_deliveries"."status" = 'EM_ANALISE'
          AND "eap_milestone_deliveries"."decided_by" IS NULL
          AND "eap_milestone_deliveries"."decided_at" IS NULL
        ) OR (
          "eap_milestone_deliveries"."status" = 'ACEITA'
          AND "eap_milestone_deliveries"."decided_by" IS NOT NULL
          AND "eap_milestone_deliveries"."decided_at" IS NOT NULL
        ) OR (
          "eap_milestone_deliveries"."status" IN ('AJUSTES_SOLICITADOS', 'REJEITADA')
          AND "eap_milestone_deliveries"."decided_by" IS NOT NULL
          AND "eap_milestone_deliveries"."decided_at" IS NOT NULL
          AND char_length(btrim("eap_milestone_deliveries"."decision_note")) >= 10
        )
      )),
	CONSTRAINT "eap_milestone_deliveries_resubmission_chk" CHECK ((
        "eap_milestone_deliveries"."resubmission_authorized_at" IS NULL
        AND "eap_milestone_deliveries"."resubmission_authorized_by" IS NULL
        AND "eap_milestone_deliveries"."resubmission_note" IS NULL
      ) OR (
        "eap_milestone_deliveries"."status" = 'REJEITADA'
        AND "eap_milestone_deliveries"."resubmission_authorized_at" IS NOT NULL
        AND "eap_milestone_deliveries"."resubmission_authorized_by" IS NOT NULL
        AND char_length(btrim("eap_milestone_deliveries"."resubmission_note")) >= 10
      ))
);
--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD COLUMN "delivery_id" text;--> statement-breakpoint
ALTER TABLE "eap_milestones" ADD COLUMN "reviewer_id" text;--> statement-breakpoint
ALTER TABLE "eap_milestone_deliveries" ADD CONSTRAINT "eap_milestone_deliveries_milestone_id_eap_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."eap_milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_milestone_deliveries" ADD CONSTRAINT "eap_milestone_deliveries_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_milestone_deliveries" ADD CONSTRAINT "eap_milestone_deliveries_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_milestone_deliveries" ADD CONSTRAINT "eap_milestone_deliveries_resubmission_authorized_by_user_id_fk" FOREIGN KEY ("resubmission_authorized_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eap_milestone_deliveries_milestone_id_idx" ON "eap_milestone_deliveries" USING btree ("milestone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eap_milestone_deliveries_open_idx" ON "eap_milestone_deliveries" USING btree ("milestone_id") WHERE "eap_milestone_deliveries"."status" = 'EM_ANALISE';--> statement-breakpoint
ALTER TABLE "eap_evidences" ADD CONSTRAINT "eap_evidences_delivery_id_eap_milestone_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."eap_milestone_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eap_milestones" ADD CONSTRAINT "eap_milestones_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eap_evidences_delivery_id_idx" ON "eap_evidences" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "eap_milestones_reviewer_id_idx" ON "eap_milestones" USING btree ("reviewer_id");