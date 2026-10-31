-- Remove somente os registros fictícios da Visão Institucional criados por institutional-demo.sql.
BEGIN;
DELETE FROM project_highlights WHERE id LIKE 'demo-inst-%';
DELETE FROM project_results WHERE id LIKE 'demo-inst-%';
DELETE FROM project_profile_fields WHERE id LIKE 'demo-inst-%';
DELETE FROM eap_evidences WHERE id LIKE 'demo-inst-%';
UPDATE projects SET pmo_glpi_ticket_id = NULL WHERE id = 'demo-proj-05' AND pmo_glpi_ticket_id = '900123';
COMMIT;
