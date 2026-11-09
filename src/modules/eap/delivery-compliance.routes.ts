import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

import type { Database } from "../../db/types";
import { getAuthUser, requireAuth } from "../../lib/session";
import { makeEapRepos } from "./factories/make-eap-controller";
import type { EapTransactionRunner } from "./repositories/contracts";
import {
  checklistRevisionSchema,
  checklistTemplateListSchema,
  complianceErrorResponses,
  createDeliveryVersionBodySchema,
  deliveryVersionListSchema,
  deliveryVersionSchema,
  natureParamsSchema,
  saveChecklistDraftBodySchema,
  versionParamsSchema,
} from "./schemas/eap-delivery-compliance.schema";
import { projectIdParamsSchema } from "./schemas/eap-phases.schema";
import { makeDeliveryChecklistTemplateUseCases } from "./use-cases/delivery-checklist-templates";
import { makeDeliveryVersionUseCases } from "./use-cases/delivery-versions";

const tags = ["Conformidade de Entrega"];
const security = [{ cookieAuth: [] }];

/** Casos de uso da Conformidade de Entrega ligados ao banco (mesmo padrão do módulo EAP). */
export function makeDeliveryComplianceModule(database: Database) {
  const repos = makeEapRepos(database);
  const runInTransaction: EapTransactionRunner = (fn) => database.transaction((tx) => fn(makeEapRepos(tx)));
  const deps = { repos, runInTransaction };
  return { templates: makeDeliveryChecklistTemplateUseCases(deps), versions: makeDeliveryVersionUseCases(deps) };
}

export type DeliveryComplianceModule = ReturnType<typeof makeDeliveryComplianceModule>;

export function makeDeliveryComplianceRoutes(module: DeliveryComplianceModule): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook("preHandler", requireAuth);

    app.get(
      "/delivery-checklist-templates",
      {
        schema: {
          operationId: "listDeliveryChecklistTemplates",
          tags,
          summary: "Modelos de checklist da Conformidade de Entrega",
          security,
          response: { 200: checklistTemplateListSchema, ...complianceErrorResponses },
        },
      },
      (request) => module.templates.listTemplates(getAuthUser(request)),
    );

    app.put(
      "/delivery-checklist-templates/:nature/draft",
      {
        schema: {
          operationId: "saveDeliveryChecklistDraft",
          tags,
          summary: "Cria ou substitui o rascunho do modelo (ADMIN e PMO)",
          security,
          params: natureParamsSchema,
          body: saveChecklistDraftBodySchema,
          response: { 200: checklistRevisionSchema, ...complianceErrorResponses },
        },
      },
      (request) => module.templates.saveDraft(getAuthUser(request), request.params.nature, request.body),
    );

    app.post(
      "/delivery-checklist-templates/:nature/draft/publish",
      {
        schema: {
          operationId: "publishDeliveryChecklistDraft",
          tags,
          summary: "Publica o rascunho como nova revisão do modelo (ADMIN e PMO)",
          security,
          params: natureParamsSchema,
          response: { 200: checklistRevisionSchema, ...complianceErrorResponses },
        },
      },
      (request) => module.templates.publishDraft(getAuthUser(request), request.params.nature),
    );

    app.get(
      "/projects/:id/delivery-versions",
      {
        schema: {
          operationId: "listDeliveryVersions",
          tags,
          summary: "Versões de entrega do projeto, com checklist e conformidade",
          security,
          params: projectIdParamsSchema,
          response: { 200: deliveryVersionListSchema, ...complianceErrorResponses },
        },
      },
      (request) => module.versions.listVersions(getAuthUser(request), request.params.id),
    );

    app.get(
      "/projects/:id/delivery-versions/:versionId",
      {
        schema: {
          operationId: "getDeliveryVersion",
          tags,
          summary: "Versão de entrega com itens e conformidade",
          security,
          params: versionParamsSchema,
          response: { 200: deliveryVersionSchema, ...complianceErrorResponses },
        },
      },
      (request) => module.versions.getVersion(getAuthUser(request), request.params.id, request.params.versionId),
    );

    app.post(
      "/projects/:id/delivery-versions",
      {
        schema: {
          operationId: "createDeliveryVersion",
          tags,
          summary: "Registra uma versão de entrega e copia o checklist do modelo publicado",
          security,
          params: projectIdParamsSchema,
          body: createDeliveryVersionBodySchema,
          response: { 201: deliveryVersionSchema, ...complianceErrorResponses },
        },
      },
      async (request, reply) => {
        const version = await module.versions.createVersion(getAuthUser(request), request.params.id, request.body);
        return reply.status(201).send(version);
      },
    );
  };
}
