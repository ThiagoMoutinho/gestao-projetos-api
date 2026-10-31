-- Adiciona dois campos narrativos ao enum project_profile_field. Aditiva: nenhum registro existente é alterado, copiado ou apagado.
ALTER TYPE "public"."project_profile_field" ADD VALUE IF NOT EXISTS 'SYSTEM_DESCRIPTION';--> statement-breakpoint
ALTER TYPE "public"."project_profile_field" ADD VALUE IF NOT EXISTS 'RESULTS_SUMMARY';
