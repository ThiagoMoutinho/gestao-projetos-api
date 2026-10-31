-- Preferência de interface: layout pessoal da Visão Geral. Tabela nova e aditiva; nenhum dado existente é alterado.
CREATE TABLE "user_overview_layouts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"widgets" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_overview_layouts" ADD CONSTRAINT "user_overview_layouts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;