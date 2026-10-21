ALTER TABLE "eap_milestones" ADD COLUMN "sort_order" integer;--> statement-breakpoint
WITH ranked AS (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "phase_id" ORDER BY "created_at", "title") - 1)::integer AS "sort_order"
  FROM "eap_milestones"
)
UPDATE "eap_milestones" AS milestone
SET "sort_order" = ranked."sort_order"
FROM ranked
WHERE milestone."id" = ranked."id";--> statement-breakpoint
ALTER TABLE "eap_milestones" ALTER COLUMN "sort_order" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "eap_milestones" ADD CONSTRAINT "eap_milestones_phase_sort_order_unique" UNIQUE("phase_id","sort_order");--> statement-breakpoint
ALTER TABLE "eap_milestones" ADD CONSTRAINT "eap_milestones_sort_order_chk" CHECK ("eap_milestones"."sort_order" >= 0);
