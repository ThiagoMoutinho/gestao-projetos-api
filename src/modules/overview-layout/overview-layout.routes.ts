import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

import type { Database } from "../../db/types";
import { getAuthUser, requireAuth } from "../../lib/session";
import { DrizzleOverviewLayoutRepository } from "./overview-layout.repository";
import {
  overviewLayoutBodySchema,
  overviewLayoutErrorResponses,
  overviewLayoutResponseSchema,
} from "./overview-layout.schema";
import { makeOverviewLayoutUseCases, type OverviewLayoutUseCases } from "./overview-layout.use-cases";

const tags = ["Preferências"];
const security = [{ cookieAuth: [] }];

export function makeOverviewLayoutModule(database: Database) {
  return makeOverviewLayoutUseCases(new DrizzleOverviewLayoutRepository(database));
}

export function makeOverviewLayoutRoutes(useCases: OverviewLayoutUseCases): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook("preHandler", requireAuth);

    app.get(
      "/me/overview-layout",
      {
        schema: {
          operationId: "getMyOverviewLayout",
          tags,
          summary: "Consultar o layout pessoal da Visão Geral",
          description: "Ordem e largura dos widgets escolhidas pelo usuário. `widgets: null` indica o layout padrão.",
          security,
          response: { 200: overviewLayoutResponseSchema, ...overviewLayoutErrorResponses },
        },
      },
      (request) => useCases.get(getAuthUser(request)),
    );

    app.put(
      "/me/overview-layout",
      {
        schema: {
          operationId: "saveMyOverviewLayout",
          tags,
          summary: "Salvar o layout pessoal da Visão Geral",
          security,
          body: overviewLayoutBodySchema,
          response: { 200: overviewLayoutResponseSchema, ...overviewLayoutErrorResponses },
        },
      },
      (request) => useCases.save(getAuthUser(request), request.body.widgets),
    );

    app.delete(
      "/me/overview-layout",
      {
        schema: {
          operationId: "resetMyOverviewLayout",
          tags,
          summary: "Restaurar o layout padrão da Visão Geral",
          security,
          response: { 200: overviewLayoutResponseSchema, ...overviewLayoutErrorResponses },
        },
      },
      (request) => useCases.reset(getAuthUser(request)),
    );
  };
}
