import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireAuth } from "../../lib/session";
import { projectIdParamsSchema } from "../projects/schemas/projects.schema";
import { eapEvidenceSchema } from "../eap/schemas/eap-evidences.schema";
import type { InstitutionalController } from "./institutional.controller";
import {
  createResultBodySchema,
  decisionBodySchema,
  highlightParamsSchema,
  highlightResponseSchema,
  institutionalErrorResponses,
  profileFieldViewSchema,
  profileParamsSchema,
  projectOverviewSchema,
  projectResultViewSchema,
  resultEvidenceBodySchema,
  resultParamsSchema,
  saveProfileBodySchema,
  updateResultBodySchema,
} from "./schemas/institutional.schema";

const tags = ["Visão institucional"];
const security = [{ cookieAuth: [] }];

export function makeInstitutionalRoutes(controller: InstitutionalController): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook("preHandler", requireAuth);

    app.get(
      "/projects/:id/overview",
      {
        schema: {
          operationId: "getProjectOverview",
          tags,
          summary: "Consultar a visão institucional do projeto",
          description:
            "Contrato de leitura reutilizável pela Visão Geral e pelo Painel do Gestor: origem (chamados GLPI), perfil validado, resultados, evoluções reais da EAP e evidências.",
          security,
          params: projectIdParamsSchema,
          response: { 200: projectOverviewSchema, ...institutionalErrorResponses },
        },
      },
      (request) => controller.overview(request),
    );

    app.put(
      "/projects/:id/profile/:field",
      {
        schema: {
          operationId: "saveProjectProfileField",
          tags,
          summary: "Salvar rascunho de um campo institucional",
          description: "Preserva a última versão publicada; a alteração só é publicada após validação por outro usuário.",
          security,
          params: profileParamsSchema,
          body: saveProfileBodySchema,
          response: { 200: profileFieldViewSchema, ...institutionalErrorResponses },
        },
      },
      (request) => controller.saveProfile(request),
    );

    app.post(
      "/projects/:id/profile/:field/decision",
      {
        schema: {
          operationId: "decideProjectProfileField",
          tags,
          summary: "Validar ou rejeitar a alteração pendente de um campo institucional",
          security,
          params: profileParamsSchema,
          body: decisionBodySchema,
          response: { 200: profileFieldViewSchema, ...institutionalErrorResponses },
        },
      },
      (request) => controller.decideProfile(request),
    );

    app.post(
      "/projects/:id/results",
      {
        schema: {
          operationId: "createProjectResult",
          tags,
          summary: "Cadastrar resultado esperado ou alcançado",
          security,
          params: projectIdParamsSchema,
          body: createResultBodySchema,
          response: { 201: projectResultViewSchema, ...institutionalErrorResponses },
        },
      },
      (request, reply) => controller.createResult(request, reply),
    );

    app.patch(
      "/projects/:id/results/:resultId",
      {
        schema: {
          operationId: "updateProjectResult",
          tags,
          summary: "Editar resultado (salva como rascunho)",
          security,
          params: resultParamsSchema,
          body: updateResultBodySchema,
          response: { 200: projectResultViewSchema, ...institutionalErrorResponses },
        },
      },
      (request) => controller.updateResult(request),
    );

    app.post(
      "/projects/:id/results/:resultId/decision",
      {
        schema: {
          operationId: "decideProjectResult",
          tags,
          summary: "Validar ou rejeitar um resultado alcançado",
          description:
            "Só para alcançados. A rejeição exige justificativa e mantém o rascunho como Correções solicitadas. Esperados são publicados direto.",
          security,
          params: resultParamsSchema,
          body: decisionBodySchema,
          response: { 200: projectResultViewSchema, ...institutionalErrorResponses },
        },
      },
      (request) => controller.decideResult(request),
    );

    app.post(
      "/projects/:id/results/:resultId/evidences",
      {
        schema: {
          operationId: "registerProjectResultEvidence",
          tags,
          summary: "Vincular evidência (link de documento) a um resultado",
          security,
          params: resultParamsSchema,
          body: resultEvidenceBodySchema,
          response: { 201: eapEvidenceSchema, ...institutionalErrorResponses },
        },
      },
      (request, reply) => controller.registerResultEvidence(request, reply),
    );

    app.post(
      "/projects/:id/results/:resultId/archive",
      {
        schema: {
          operationId: "archiveProjectResult",
          tags,
          summary: "Arquivar resultado (sem exclusão)",
          security,
          params: resultParamsSchema,
          response: { 204: z.undefined(), ...institutionalErrorResponses },
        },
      },
      (request, reply) => controller.archiveResult(request, reply),
    );

    app.put(
      "/projects/:id/highlights/:milestoneId",
      {
        schema: {
          operationId: "highlightProjectMilestone",
          tags,
          summary: "Destacar marco aprovado da EAP como evolução",
          security,
          params: highlightParamsSchema,
          response: { 200: highlightResponseSchema, ...institutionalErrorResponses },
        },
      },
      (request) => controller.setHighlight(request),
    );

    app.delete(
      "/projects/:id/highlights/:milestoneId",
      {
        schema: {
          operationId: "removeProjectMilestoneHighlight",
          tags,
          summary: "Remover destaque de marco",
          security,
          params: highlightParamsSchema,
          response: { 204: z.undefined(), ...institutionalErrorResponses },
        },
      },
      (request, reply) => controller.removeHighlight(request, reply),
    );
  };
}
