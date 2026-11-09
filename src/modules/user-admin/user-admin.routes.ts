import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

import type { Database } from "../../db/types";
import { errorResponseSchema } from "../../lib/http-error";
import { getAuthUser, requireAuth } from "../../lib/session";
import { DrizzleUserAdminRepository } from "./user-admin.repository";
import {
  adminUserListSchema,
  adminUserSchema,
  makeUserAdminUseCases,
  userActivationBodySchema,
  userParamsSchema,
  type UserAdminUseCases,
} from "./user-admin.use-cases";

const tags = ["Administração de usuários"];
const security = [{ cookieAuth: [] }];
const errors = { 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema };

export function makeUserAdminModule(database: Database) {
  return makeUserAdminUseCases(new DrizzleUserAdminRepository(database));
}

/** Ativação e desativação de usuários (somente ADMIN). Usuário inativo não entra, não mantém sessão e não recebe avisos. */
export function makeUserAdminRoutes(useCases: UserAdminUseCases): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook("preHandler", requireAuth);

    app.get(
      "/users",
      {
        schema: {
          operationId: "listUsersForAdmin",
          tags,
          summary: "Usuários e situação de ativação (ADMIN)",
          security,
          response: { 200: adminUserListSchema, ...errors },
        },
      },
      (request) => useCases.list(getAuthUser(request)),
    );

    app.post(
      "/users/:id/deactivation",
      {
        schema: {
          operationId: "deactivateUser",
          tags,
          summary: "Desativar usuário (ADMIN): encerra as sessões; não desativa o último ADMIN ativo",
          security,
          params: userParamsSchema,
          body: userActivationBodySchema,
          response: { 200: adminUserSchema, ...errors },
        },
      },
      (request) => useCases.deactivate(getAuthUser(request), request.params.id, request.body.reason),
    );

    app.post(
      "/users/:id/activation",
      {
        schema: {
          operationId: "activateUser",
          tags,
          summary: "Reativar usuário (ADMIN)",
          security,
          params: userParamsSchema,
          body: userActivationBodySchema,
          response: { 200: adminUserSchema, ...errors },
        },
      },
      (request) => useCases.activate(getAuthUser(request), request.params.id, request.body.reason),
    );
  };
}
