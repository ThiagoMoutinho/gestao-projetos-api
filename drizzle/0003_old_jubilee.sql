CREATE TYPE "public"."project_member_role" AS ENUM('DONO_PROJETO', 'GESTOR', 'PO', 'DESENVOLVEDOR', 'RESPONSAVEL_TECNICO', 'FORNECEDOR', 'OBSERVADOR');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('NAO_INICIADO', 'EM_EXECUCAO', 'EM_ATENCAO', 'CRITICO', 'EM_VALIDACAO', 'CONCLUIDO', 'SUSPENSO');--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "project_member_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"glpi_ticket_id" text,
	"owner_id" text NOT NULL,
	"status" "project_status" DEFAULT 'NAO_INICIADO' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;