ALTER TABLE "project_profile_fields" DROP CONSTRAINT "project_profile_fields_published_complete_chk";--> statement-breakpoint
ALTER TABLE "project_profile_fields" ADD CONSTRAINT "project_profile_fields_published_complete_chk" CHECK ((
        ("project_profile_fields"."published_value" IS NULL) = ("project_profile_fields"."published_by" IS NULL)
        AND ("project_profile_fields"."published_value" IS NULL) = ("project_profile_fields"."published_at" IS NULL)
        AND ("project_profile_fields"."validated_by" IS NULL) = ("project_profile_fields"."validated_at" IS NULL)
        AND ("project_profile_fields"."validated_by" IS NULL OR "project_profile_fields"."published_value" IS NOT NULL)
      ));