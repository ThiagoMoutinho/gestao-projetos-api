ALTER TABLE "eap_tasks" ADD COLUMN "sort_order" integer;--> statement-breakpoint
WITH ranked AS (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "phase_id" ORDER BY "title", "created_at") - 1)::integer AS "sort_order"
  FROM "eap_tasks"
)
UPDATE "eap_tasks" AS task
SET "sort_order" = ranked."sort_order"
FROM ranked
WHERE task."id" = ranked."id";--> statement-breakpoint
ALTER TABLE "eap_tasks" ALTER COLUMN "sort_order" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "eap_tasks" ADD CONSTRAINT "eap_tasks_phase_sort_order_unique" UNIQUE("phase_id","sort_order");--> statement-breakpoint
ALTER TABLE "eap_tasks" ADD CONSTRAINT "eap_tasks_sort_order_chk" CHECK ("eap_tasks"."sort_order" >= 0);
