import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

import type { Database } from "../../db/types";
import { getAuthUser, requireAuth } from "../../lib/session";
import { DrizzleSearchRepository } from "./search.repository";
import { searchErrorResponses, searchQuerySchema, searchResponseSchema } from "./search.schema";
import { makeSearchUseCases, type SearchUseCases } from "./search.use-cases";

const tags = ["Busca"];
const security = [{ cookieAuth: [] }];

export function makeSearchModule(database: Database) {
  return makeSearchUseCases(new DrizzleSearchRepository(database));
}

export function makeSearchRoutes(useCases: SearchUseCases): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook("preHandler", requireAuth);

    app.get(
      "/search",
      {
        schema: {
          operationId: "searchWorkspace",
          tags,
          summary: "Busca global",
          description:
            "Pesquisa projetos, chamados GLPI, atas, itens da EAP, evidências, entregas, textos publicados do projeto, impedimentos e (só para ADMIN, PMO e COORDENADOR) pessoas. Sem acento e por palavras, em qualquer ordem. Só devolve itens de projetos que o usuário pode ver.",
          security,
          querystring: searchQuerySchema,
          response: { 200: searchResponseSchema, ...searchErrorResponses },
        },
      },
      (request) => useCases.search(getAuthUser(request), request.query.q, request.query.perKind),
    );
  };
}
