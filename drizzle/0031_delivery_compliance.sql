CREATE TABLE "delivery_checklist_template_items" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"position" integer NOT NULL,
	"document_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"required" boolean DEFAULT true NOT NULL,
	CONSTRAINT "delivery_checklist_template_items_pos_chk" CHECK ("delivery_checklist_template_items"."position" >= 1),
	CONSTRAINT "delivery_checklist_template_items_title_chk" CHECK (char_length(btrim("delivery_checklist_template_items"."title")) >= 3)
);
--> statement-breakpoint
CREATE TABLE "delivery_checklist_template_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'RASCUNHO' NOT NULL,
	"is_proposal" boolean DEFAULT false NOT NULL,
	"source_note" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_by" text,
	"published_at" timestamp,
	CONSTRAINT "delivery_checklist_template_revisions_status_chk" CHECK ("delivery_checklist_template_revisions"."status" IN ('RASCUNHO', 'PUBLICADA')),
	CONSTRAINT "delivery_checklist_template_revisions_rev_chk" CHECK ("delivery_checklist_template_revisions"."revision" >= 1),
	CONSTRAINT "delivery_checklist_template_revisions_published_chk" CHECK (("delivery_checklist_template_revisions"."status" = 'RASCUNHO' AND "delivery_checklist_template_revisions"."published_at" IS NULL) OR ("delivery_checklist_template_revisions"."status" = 'PUBLICADA' AND "delivery_checklist_template_revisions"."published_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "delivery_checklist_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"nature" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_checklist_templates_nature_chk" CHECK ("delivery_checklist_templates"."nature" IN ('SISTEMAS', 'INFRAESTRUTURA', 'PROCESSOS'))
);
--> statement-breakpoint
CREATE TABLE "project_delivery_item_events" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"evidence_kind" text,
	"evidence_ref" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_delivery_item_events_action_chk" CHECK ("project_delivery_item_events"."action" IN ('ENVIO', 'APROVACAO', 'REJEICAO', 'DISPENSA'))
);
--> statement-breakpoint
CREATE TABLE "project_delivery_version_items" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"template_item_id" text,
	"position" integer NOT NULL,
	"document_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"required" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'PENDENTE' NOT NULL,
	"evidence_kind" text,
	"evidence_ref" text,
	"submitted_by" text,
	"submitted_at" timestamp,
	"validator_id" text,
	"decided_by" text,
	"decided_at" timestamp,
	"decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_delivery_version_items_status_chk" CHECK ("project_delivery_version_items"."status" IN ('PENDENTE', 'ENVIADO', 'APROVADO', 'REJEITADO', 'DISPENSADO')),
	CONSTRAINT "project_delivery_version_items_evidence_kind_chk" CHECK ("project_delivery_version_items"."evidence_kind" IS NULL OR "project_delivery_version_items"."evidence_kind" IN ('SHAREPOINT', 'GITLAB_TAG', 'GITLAB_RELEASE', 'OUTRO')),
	CONSTRAINT "project_delivery_version_items_evidence_chk" CHECK (("project_delivery_version_items"."evidence_ref" IS NULL AND "project_delivery_version_items"."evidence_kind" IS NULL) OR ("project_delivery_version_items"."evidence_ref" IS NOT NULL AND "project_delivery_version_items"."evidence_kind" IS NOT NULL AND char_length(btrim("project_delivery_version_items"."evidence_ref")) BETWEEN 1 AND 1000)),
	CONSTRAINT "project_delivery_version_items_decision_chk" CHECK ((
        ("project_delivery_version_items"."status" = 'PENDENTE' AND "project_delivery_version_items"."evidence_ref" IS NULL AND "project_delivery_version_items"."submitted_by" IS NULL AND "project_delivery_version_items"."submitted_at" IS NULL AND "project_delivery_version_items"."decided_by" IS NULL AND "project_delivery_version_items"."decided_at" IS NULL)
        OR ("project_delivery_version_items"."status" = 'ENVIADO' AND "project_delivery_version_items"."evidence_ref" IS NOT NULL AND "project_delivery_version_items"."submitted_by" IS NOT NULL AND "project_delivery_version_items"."submitted_at" IS NOT NULL AND "project_delivery_version_items"."decided_by" IS NULL AND "project_delivery_version_items"."decided_at" IS NULL)
        OR ("project_delivery_version_items"."status" = 'APROVADO' AND "project_delivery_version_items"."evidence_ref" IS NOT NULL AND "project_delivery_version_items"."submitted_by" IS NOT NULL AND "project_delivery_version_items"."decided_by" IS NOT NULL AND "project_delivery_version_items"."decided_at" IS NOT NULL AND "project_delivery_version_items"."decided_by" <> "project_delivery_version_items"."submitted_by")
        OR ("project_delivery_version_items"."status" = 'REJEITADO' AND "project_delivery_version_items"."evidence_ref" IS NOT NULL AND "project_delivery_version_items"."submitted_by" IS NOT NULL AND "project_delivery_version_items"."decided_by" IS NOT NULL AND "project_delivery_version_items"."decided_at" IS NOT NULL AND char_length(btrim("project_delivery_version_items"."decision_note")) >= 10)
        OR ("project_delivery_version_items"."status" = 'DISPENSADO' AND "project_delivery_version_items"."decided_by" IS NOT NULL AND "project_delivery_version_items"."decided_at" IS NOT NULL AND char_length(btrim("project_delivery_version_items"."decision_note")) >= 10)
      ))
);
--> statement-breakpoint
CREATE TABLE "project_delivery_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version_label" text NOT NULL,
	"nature" text NOT NULL,
	"template_revision_id" text NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_delivery_versions_nature_chk" CHECK ("project_delivery_versions"."nature" IN ('SISTEMAS', 'INFRAESTRUTURA', 'PROCESSOS')),
	CONSTRAINT "project_delivery_versions_label_chk" CHECK ("project_delivery_versions"."version_label" ~ '^[0-9]+(\.[0-9]+){0,2}$')
);
--> statement-breakpoint
ALTER TABLE "eap_milestone_deliveries" ADD COLUMN "delivery_version_id" text;--> statement-breakpoint
ALTER TABLE "delivery_checklist_template_items" ADD CONSTRAINT "delivery_checklist_template_items_revision_id_delivery_checklist_template_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."delivery_checklist_template_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_checklist_template_revisions" ADD CONSTRAINT "delivery_checklist_template_revisions_template_id_delivery_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."delivery_checklist_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_checklist_template_revisions" ADD CONSTRAINT "delivery_checklist_template_revisions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_checklist_template_revisions" ADD CONSTRAINT "delivery_checklist_template_revisions_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_item_events" ADD CONSTRAINT "project_delivery_item_events_item_id_project_delivery_version_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."project_delivery_version_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_item_events" ADD CONSTRAINT "project_delivery_item_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_version_items" ADD CONSTRAINT "project_delivery_version_items_version_id_project_delivery_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."project_delivery_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_version_items" ADD CONSTRAINT "project_delivery_version_items_template_item_id_delivery_checklist_template_items_id_fk" FOREIGN KEY ("template_item_id") REFERENCES "public"."delivery_checklist_template_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_version_items" ADD CONSTRAINT "project_delivery_version_items_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_version_items" ADD CONSTRAINT "project_delivery_version_items_validator_id_user_id_fk" FOREIGN KEY ("validator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_version_items" ADD CONSTRAINT "project_delivery_version_items_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_versions" ADD CONSTRAINT "project_delivery_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_versions" ADD CONSTRAINT "project_delivery_versions_template_revision_id_delivery_checklist_template_revisions_id_fk" FOREIGN KEY ("template_revision_id") REFERENCES "public"."delivery_checklist_template_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_versions" ADD CONSTRAINT "project_delivery_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_checklist_template_items_pos_uq" ON "delivery_checklist_template_items" USING btree ("revision_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_checklist_template_revisions_rev_uq" ON "delivery_checklist_template_revisions" USING btree ("template_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_checklist_template_revisions_draft_uq" ON "delivery_checklist_template_revisions" USING btree ("template_id") WHERE "delivery_checklist_template_revisions"."status" = 'RASCUNHO';--> statement-breakpoint
CREATE INDEX "delivery_checklist_template_revisions_template_idx" ON "delivery_checklist_template_revisions" USING btree ("template_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_checklist_templates_nature_uq" ON "delivery_checklist_templates" USING btree ("nature");--> statement-breakpoint
CREATE INDEX "project_delivery_item_events_item_idx" ON "project_delivery_item_events" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_delivery_version_items_pos_uq" ON "project_delivery_version_items" USING btree ("version_id","position");--> statement-breakpoint
CREATE INDEX "project_delivery_version_items_version_idx" ON "project_delivery_version_items" USING btree ("version_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_delivery_versions_label_uq" ON "project_delivery_versions" USING btree ("project_id","version_label");--> statement-breakpoint
CREATE INDEX "project_delivery_versions_project_idx" ON "project_delivery_versions" USING btree ("project_id","created_at");--> statement-breakpoint
ALTER TABLE "eap_milestone_deliveries" ADD CONSTRAINT "eap_milestone_deliveries_delivery_version_id_project_delivery_versions_id_fk" FOREIGN KEY ("delivery_version_id") REFERENCES "public"."project_delivery_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eap_milestone_deliveries_version_idx" ON "eap_milestone_deliveries" USING btree ("delivery_version_id");