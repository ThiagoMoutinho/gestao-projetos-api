-- Modelos iniciais da Conformidade de Entrega (somente inserções; nenhuma tabela ou dado existente é alterado).
-- Sistemas: baseado na lista "O que cobrar antes da homologação" do Manual de governança da homologação de projetos de TI
-- (minuta da CTIN). Infraestrutura e Processos: PROPOSTAS sujeitas à validação da CTIN (is_proposal = true).
-- ADMIN e PMO podem criar rascunhos e publicar novas revisões; revisões publicadas nunca são alteradas.

INSERT INTO "delivery_checklist_templates" ("id", "nature", "name") VALUES
  ('tpl-sistemas', 'SISTEMAS', 'Sistemas e desenvolvimento de software'),
  ('tpl-infraestrutura', 'INFRAESTRUTURA', 'Infraestrutura e tecnologia'),
  ('tpl-processos', 'PROCESSOS', 'Processos e serviços');--> statement-breakpoint

INSERT INTO "delivery_checklist_template_revisions" ("id", "template_id", "revision", "status", "is_proposal", "source_note", "notes", "published_at") VALUES
  ('rev-sistemas-1', 'tpl-sistemas', 1, 'PUBLICADA', false,
   'Baseado no Manual de governança da homologação de projetos de TI (minuta da CTIN), seção "O que cobrar antes da homologação". O PDF "Processo Entrega Projetos IGEPPS" não pôde ser lido automaticamente: conferir esta lista com o PDF e publicar uma nova revisão se houver diferença.',
   'Revisão inicial.', now()),
  ('rev-infraestrutura-1', 'tpl-infraestrutura', 1, 'PUBLICADA', true,
   'Proposta sujeita à validação da CTIN. Elaborada por analogia com o modelo de Sistemas.',
   'Revisão inicial (proposta).', now()),
  ('rev-processos-1', 'tpl-processos', 1, 'PUBLICADA', true,
   'Proposta sujeita à validação da CTIN. Elaborada por analogia com o modelo de Sistemas.',
   'Revisão inicial (proposta).', now());--> statement-breakpoint

INSERT INTO "delivery_checklist_template_items" ("id", "revision_id", "position", "document_type", "title", "description", "required") VALUES
  ('tpli-sis-01', 'rev-sistemas-1', 1, 'ESCOPO_CRITERIOS', 'Escopo e critérios de aceite', 'Lista das funcionalidades e requisitos aprovados, com resultado esperado e limites da entrega.', true),
  ('tpli-sis-02', 'rev-sistemas-1', 2, 'VERSAO_NOTAS', 'Versão identificada e notas da entrega', 'Número da versão, data, notas da entrega e referência ao código (tag ou release do GitLab).', true),
  ('tpli-sis-03', 'rev-sistemas-1', 3, 'AMBIENTE_ACESSOS', 'Ambiente e acessos', 'Endereço do ambiente, disponibilidade, perfis de teste e confirmação de acesso dos participantes.', true),
  ('tpli-sis-04', 'rev-sistemas-1', 4, 'PLANO_TESTES', 'Plano de testes', 'Cenários, passos, resultado esperado, validador e critérios para aprovação.', true),
  ('tpli-sis-05', 'rev-sistemas-1', 5, 'DADOS_TESTE', 'Dados para teste', 'Massa fictícia ou sintética apropriada; exceção segue aprovação e controles institucionais.', true),
  ('tpli-sis-06', 'rev-sistemas-1', 6, 'TESTES_PREVIOS', 'Testes prévios da executora e defeitos conhecidos', 'Resultados dos testes internos e lista de defeitos já conhecidos.', true),
  ('tpli-sis-07', 'rev-sistemas-1', 7, 'INTEGRACOES_DEPENDENCIAS', 'Integrações e dependências', 'Sistemas envolvidos, pré-requisitos, responsáveis e disponibilidade; informar se o teste é real, simulado ou parcial.', false),
  ('tpli-sis-08', 'rev-sistemas-1', 8, 'DOCUMENTACAO', 'Documentação pertinente', 'Manual de uso, alterações de processo e orientações técnicas necessárias ao recorte testado.', true),
  ('tpli-sis-09', 'rev-sistemas-1', 9, 'PARTICIPANTES_PAUTA', 'Participantes e pauta', 'Usuários validadores, equipes técnicas, aprovador, duração e sequência dos testes.', false),

  ('tpli-inf-01', 'rev-infraestrutura-1', 1, 'ESCOPO_CRITERIOS', 'Escopo e critérios de aceite', 'Componentes, capacidades e requisitos aprovados, com resultado esperado.', true),
  ('tpli-inf-02', 'rev-infraestrutura-1', 2, 'ARQUITETURA', 'Arquitetura e diagrama da solução', 'Desenho da solução implantada, topologia, dependências e responsáveis.', true),
  ('tpli-inf-03', 'rev-infraestrutura-1', 3, 'INVENTARIO_CONFIGURACAO', 'Inventário de ativos e configurações', 'Relação de equipamentos, versões, endereços e parâmetros relevantes.', true),
  ('tpli-inf-04', 'rev-infraestrutura-1', 4, 'PLANO_IMPLANTACAO', 'Plano de implantação e retorno (rollback)', 'Passos, janela, responsáveis e plano de retorno.', true),
  ('tpli-inf-05', 'rev-infraestrutura-1', 5, 'EVIDENCIAS_TESTES', 'Evidências de testes de aceitação e desempenho', 'Resultados dos testes executados no ambiente e critérios atendidos.', true),
  ('tpli-inf-06', 'rev-infraestrutura-1', 6, 'PARECER_SEGURANCA', 'Parecer de segurança', 'Avaliação de segurança aplicável à solução, com limitações e pendências.', true),
  ('tpli-inf-07', 'rev-infraestrutura-1', 7, 'DOCUMENTACAO_OPERACIONAL', 'Documentação operacional', 'Procedimentos de operação, monitoramento, backup e continuidade.', true),
  ('tpli-inf-08', 'rev-infraestrutura-1', 8, 'ACESSOS_CREDENCIAIS', 'Acessos e responsabilidades de administração', 'Perfis de acesso e responsáveis, sem registrar senhas.', false),

  ('tpli-pro-01', 'rev-processos-1', 1, 'ESCOPO_CRITERIOS', 'Escopo e critérios de aceite', 'Abrangência do processo ou serviço, resultado esperado e limites da entrega.', true),
  ('tpli-pro-02', 'rev-processos-1', 2, 'DESCRICAO_PROCESSO', 'Descrição e mapeamento do processo', 'Fluxo, atores, entradas, saídas e regras de negócio.', true),
  ('tpli-pro-03', 'rev-processos-1', 3, 'INDICADORES_NIVEIS_SERVICO', 'Indicadores e níveis de serviço', 'Indicadores de desempenho, metas e forma de medição.', false),
  ('tpli-pro-04', 'rev-processos-1', 4, 'MANUAL_PROCEDIMENTOS', 'Manual de procedimentos e orientações de uso', 'Instruções para execução do processo pelas áreas envolvidas.', true),
  ('tpli-pro-05', 'rev-processos-1', 5, 'TREINAMENTO_COMUNICACAO', 'Treinamento e plano de comunicação', 'Registro do treinamento realizado e da comunicação aos envolvidos.', true),
  ('tpli-pro-06', 'rev-processos-1', 6, 'ACEITE_AREA_DEMANDANTE', 'Manifestação da área demandante', 'Registro da conferência funcional e da aderência às necessidades.', true);
