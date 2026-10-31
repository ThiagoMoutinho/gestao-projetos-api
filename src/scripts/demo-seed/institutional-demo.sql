-- Dados fictícios da Visão Institucional (somente ambiente de desenvolvimento).
-- Usa os usuários e projetos do seed demo; ids "demo-inst-*" e idempotente (ON CONFLICT DO NOTHING).
-- Remoção: institutional-demo-clean.sql.
BEGIN;

-- Projeto 05 (Adequação de Identidade): gestor = demo-user-seguranca; PMO = demo-user-pmo.
INSERT INTO project_profile_fields (id, project_id, field, published_value, published_by, published_at, validated_by, validated_at, draft_value, draft_by, draft_at) VALUES
 ('demo-inst-pf-05-purpose','demo-proj-05','PURPOSE','Centralizar a gestão de identidades e acessos dos sistemas institucionais. Registro fictício.','demo-user-seguranca',now()-interval '20 days','demo-user-pmo',now()-interval '19 days',NULL,NULL,NULL),
 ('demo-inst-pf-05-scope','demo-proj-05','SCOPE','Inclui o diretório central, o provedor de login único e a migração de 12 sistemas. Não inclui a troca dos equipamentos de rede. Registro fictício.','demo-user-seguranca',now()-interval '20 days','demo-user-pmo',now()-interval '19 days',
   'Inclui o diretório central, o login único, a migração de 15 sistemas e a política de senhas. Registro fictício.','demo-user-seguranca',now()-interval '2 days'),
 ('demo-inst-pf-05-problem','demo-proj-05','PROBLEM',NULL,NULL,NULL,NULL,NULL,'Cada sistema mantém usuários e senhas próprios, o que gera retrabalho no cadastro e risco de acessos esquecidos. Registro fictício.','demo-user-seguranca',now()-interval '1 day'),
 ('demo-inst-pf-05-req','demo-proj-05','REQUESTING_AREA','Coordenação de Segurança da Informação. Registro fictício.','demo-user-seguranca',now()-interval '20 days','demo-user-pmo',now()-interval '19 days',NULL,NULL,NULL),
 ('demo-inst-pf-05-resp','demo-proj-05','RESPONSIBLE_COMPANY','Gerência de Infraestrutura e Segurança. Registro fictício.','demo-user-seguranca',now()-interval '20 days','demo-user-pmo',now()-interval '19 days',
   'Gerência de Infraestrutura e Segurança, com apoio da Gerência de Sistemas. Registro fictício.','demo-user-pmo',now()-interval '3 hours')
ON CONFLICT DO NOTHING;
INSERT INTO project_profile_fields (id, project_id, field, published_value, published_by, published_at, validated_by, validated_at) VALUES
 ('demo-inst-pf-05-benef','demo-proj-05','BENEFITED_SECTORS','CTIN, RH, Financeiro','demo-user-seguranca',now()-interval '20 days','demo-user-pmo',now()-interval '19 days')
ON CONFLICT DO NOTHING;

INSERT INTO project_results (id, project_id, type, created_by, created_at, published_text, published_result_date, published_milestone_id, published_by, published_at, validated_by, validated_at, draft_text, draft_result_date, draft_milestone_id, draft_by, draft_at) VALUES
 ('demo-inst-pr-05-e1','demo-proj-05','ESPERADO','demo-user-seguranca',now()-interval '20 days','Acesso único a todos os sistemas institucionais, com um só usuário e senha. Registro fictício.',NULL,NULL,'demo-user-seguranca',now()-interval '20 days','demo-user-pmo',now()-interval '19 days',NULL,NULL,NULL,NULL,NULL),
 ('demo-inst-pr-05-e2','demo-proj-05','ESPERADO','demo-user-seguranca',now()-interval '1 day',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'Redução de 70% nos chamados de recuperação de senha. Registro fictício.',NULL,NULL,'demo-user-seguranca',now()-interval '1 day'),
 ('demo-inst-pr-05-a1','demo-proj-05','ALCANCADO','demo-user-seguranca',now()-interval '10 days','Identidade piloto aprovada e em uso por dois sistemas. Registro fictício.',(now()-interval '10 days')::date,'demo-milestone-05-pendente','demo-user-seguranca',now()-interval '10 days','demo-user-pmo',now()-interval '9 days',NULL,NULL,NULL,NULL,NULL)
ON CONFLICT DO NOTHING;

INSERT INTO project_highlights (id, project_id, milestone_id, highlighted_by, highlighted_at, sort_order) VALUES
 ('demo-inst-hl-05-1','demo-proj-05','demo-milestone-05-pendente','demo-user-pmo',now()-interval '9 days',0)
ON CONFLICT DO NOTHING;

INSERT INTO eap_evidences (id, project_id, title, url, created_by, created_at) VALUES
 ('demo-inst-ev-05-1','demo-proj-05','Termo de abertura (fictício)','https://exemplo.com/documentos/termo-abertura','demo-user-seguranca',now()-interval '18 days'),
 ('demo-inst-ev-05-2','demo-proj-05','Ata de kick-off (fictícia)','https://exemplo.com/documentos/ata-kickoff','demo-user-pmo',now()-interval '17 days')
ON CONFLICT DO NOTHING;

UPDATE projects SET pmo_glpi_ticket_id = '900123' WHERE id = 'demo-proj-05' AND pmo_glpi_ticket_id IS NULL;

-- Projeto 08 (Relatório de Capacidade): gestor = demo-user-sistemas; tudo validado.
INSERT INTO project_profile_fields (id, project_id, field, published_value, published_by, published_at, validated_by, validated_at) VALUES
 ('demo-inst-pf-08-purpose','demo-proj-08','PURPOSE','Apoiar o planejamento de capacidade com um relatório mensal de uso dos servidores. Registro fictício.','demo-user-sistemas',now()-interval '30 days','demo-user-pmo',now()-interval '29 days'),
 ('demo-inst-pf-08-benef','demo-proj-08','BENEFITED_SECTORS','Infraestrutura, Planejamento, Diretoria, CTIN, Jurídico, Financeiro','demo-user-sistemas',now()-interval '30 days','demo-user-pmo',now()-interval '29 days')
ON CONFLICT DO NOTHING;

INSERT INTO project_results (id, project_id, type, created_by, created_at, published_text, published_result_date, published_milestone_id, published_by, published_at, validated_by, validated_at) VALUES
 ('demo-inst-pr-08-a1','demo-proj-08','ALCANCADO','demo-user-sistemas',now()-interval '5 days','Primeiro relatório mensal entregue e aceito. Registro fictício.',(now()-interval '5 days')::date,'demo-milestone-08-aceite','demo-user-sistemas',now()-interval '5 days','demo-user-pmo',now()-interval '4 days')
ON CONFLICT DO NOTHING;

INSERT INTO project_highlights (id, project_id, milestone_id, highlighted_by, highlighted_at, sort_order) VALUES
 ('demo-inst-hl-08-1','demo-proj-08','demo-milestone-08-aceite','demo-user-sistemas',now()-interval '4 days',0)
ON CONFLICT DO NOTHING;

COMMIT;
