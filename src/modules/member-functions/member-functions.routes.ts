import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Database } from "../../db/types";
import { getAuthUser, requireAuth } from "../../lib/session";
import { DrizzleMemberFunctionsRepository } from "./member-functions.repository";
import {
  createMemberFunctionBodySchema,
  listMemberFunctionsQuerySchema,
  memberFunctionErrorResponses,
  memberFunctionListResponseSchema,
  memberFunctionParamsSchema,
  memberFunctionSchema,
  updateMemberFunctionBodySchema,
} from "./member-functions.schema";
import { makeMemberFunctionsUseCases, type MemberFunctionsUseCases } from "./member-functions.use-cases";

const tags = ["Participantes"];
const security = [{ cookieAuth: [] }];

export function makeMemberFunctionsModule(database: Database) {
  return makeMemberFunctionsUseCases(new DrizzleMemberFunctionsRepository(database));
}

export function makeMemberFunctionsRoutes(useCases: MemberFunctionsUseCases): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook("preHandler", requireAuth);

    app.get(
      "/project-member-functions",
      {
        schema: {
          operationId: "listProjectMemberFunctions",
          tags,
          summary: "Listar as funções de participante do catálogo",
          description: "Funções institucionais que são só rótulo (ex.: Stakeholder). Quem as recebe tem o acesso de Observador.",
          security,
          querystring: listMemberFunctionsQuerySchema,
          response: { 200: memberFunctionListResponseSchema, ...memberFunctionErrorResponses },
        },
      },
      (request) => useCases.list(getAuthUser(request), request.query.includeInactive === "true"),
    );

    app.post(
      "/project-member-functions",
      {
        schema: {
          operationId: "createProjectMemberFunction",
          tags,
          summary: "Criar função de participante (ADMIN e PMO)",
          security,
          body: createMemberFunctionBodySchema,
          response: { 201: memberFunctionSchema, ...memberFunctionErrorResponses },
        },
      },
      async (request, reply) => reply.code(201).send(await useCases.create(getAuthUser(request), request.body.name)),
    );

    app.patch(
      "/project-member-functions/:id",
      {
        schema: {
          operationId: "updateProjectMemberFunction",
          tags,
          summary: "Editar, ativar ou desativar uma função de participante (ADMIN e PMO)",
          description:
            "Altera o nome e/ou a situação. O nome não pode ser de um papel fixo nem repetir outra função; função com nome de papel fixo não pode ser reativada.",
          security,
          params: memberFunctionParamsSchema,
          body: updateMemberFunctionBodySchema,
          response: { 200: memberFunctionSchema, ...memberFunctionErrorResponses },
        },
      },
      (request) => useCases.update(getAuthUser(request), request.params.id, request.body),
    );

    app.delete(
      "/project-member-functions/:id",
      {
        schema: {
          operationId: "deleteProjectMemberFunction",
          tags,
          summary: "Excluir definitivamente uma função de participante (ADMIN e PMO)",
          description:
            "Só é possível se a função nunca foi atribuída (nenhum participante a tem e nenhum registro do histórico a cita). Havendo uso, responde 409 e a função só pode ser desativada.",
          security,
          params: memberFunctionParamsSchema,
          response: { 204: z.undefined(), ...memberFunctionErrorResponses },
        },
      },
      async (request, reply) => {
        await useCases.remove(getAuthUser(request), request.params.id);
        return reply.code(204).send();
      },
    );
  };
}
