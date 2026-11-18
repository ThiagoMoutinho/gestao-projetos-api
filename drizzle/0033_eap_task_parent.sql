ALTER TABLE "eap_tasks" ADD COLUMN "parent_task_id" text;--> statement-breakpoint
ALTER TABLE "eap_tasks" ADD CONSTRAINT "eap_tasks_parent_task_id_eap_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."eap_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eap_tasks_parent_task_id_idx" ON "eap_tasks" USING btree ("parent_task_id");--> statement-breakpoint
ALTER TABLE "eap_tasks" ADD CONSTRAINT "eap_tasks_parent_not_self_chk" CHECK ("eap_tasks"."parent_task_id" IS NULL OR "eap_tasks"."parent_task_id" <> "eap_tasks"."id");