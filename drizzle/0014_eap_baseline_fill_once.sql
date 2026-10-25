-- A linha de base ausente pode ser preenchida uma única vez (definição inicial do planejamento);
-- depois de definida, continua imutável.
CREATE OR REPLACE FUNCTION eap_prevent_baseline_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'eap_milestones' THEN
    IF OLD.baseline_at IS NOT NULL AND OLD.baseline_at IS DISTINCT FROM NEW.baseline_at THEN
      RAISE EXCEPTION 'A linha de base da EAP é imutável após a criação.'
        USING ERRCODE = '23000';
    END IF;
    RETURN NEW;
  END IF;

  IF (OLD.baseline_start_at IS NOT NULL AND OLD.baseline_start_at IS DISTINCT FROM NEW.baseline_start_at)
     OR (OLD.baseline_end_at IS NOT NULL AND OLD.baseline_end_at IS DISTINCT FROM NEW.baseline_end_at) THEN
    RAISE EXCEPTION 'A linha de base da EAP é imutável após a criação.'
      USING ERRCODE = '23000';
  END IF;

  RETURN NEW;
END;
$$;
