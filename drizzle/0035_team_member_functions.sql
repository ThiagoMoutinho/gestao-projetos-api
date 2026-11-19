CREATE TABLE "project_member_functions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_functions_name_chk" CHECK (char_length(btrim("project_member_functions"."name")) BETWEEN 2 AND 60)
);
--> statement-breakpoint
ALTER TABLE "project_members" ADD COLUMN "function_id" text;--> statement-breakpoint
ALTER TABLE "project_member_functions" ADD CONSTRAINT "project_member_functions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_member_functions_name_key_uq" ON "project_member_functions" USING btree ("name_key");--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_function_id_project_member_functions_id_fk" FOREIGN KEY ("function_id") REFERENCES "public"."project_member_functions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_members_function_id_idx" ON "project_members" USING btree ("function_id");--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_function_role_chk" CHECK ("project_members"."function_id" IS NULL OR "project_members"."role" = 'OBSERVADOR');