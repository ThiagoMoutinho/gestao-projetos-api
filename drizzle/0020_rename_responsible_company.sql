-- Renomeia o valor do enum project_profile_field. Os registros existentes acompanham a renomeação (nada é copiado nem apagado).
-- A guarda torna a migration segura em bancos que já tenham o nome novo.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'project_profile_field' AND e.enumlabel = 'RESPONSIBLE_AREA'
  ) THEN
    ALTER TYPE "public"."project_profile_field" RENAME VALUE 'RESPONSIBLE_AREA' TO 'RESPONSIBLE_COMPANY';
  END IF;
END $$;
