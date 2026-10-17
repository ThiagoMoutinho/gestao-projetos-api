import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireAuth } from "../../lib/session";
import type { ProjectsController } from "./projects.controller";
import {
  addProjectMemberBodySchema,
  createProjectBodySchema,
  errorResponses,
  projectDetailResponseSchema,
  projectIdParamsSchema,
  projectListResponseSchema,
  projectMemberListResponseSchema,
  projectMemberParamsSchema,
  projectMemberSchema,
  updateProjectBodySchema,
  updateProjectMemberBodySchema,
} from "./schemas/projects.schema";

export function makeProjectsRoutes(
  controller: ProjectsController,
): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook("preHandler", requireAuth);

    app.post(
      "/projects",
      {
        schema: {
          tags: ["Projetos"],
          summary: "Cadastrar projeto",
          security: [{ cookieAuth: [] }],
          body: createProjectBodySchema,
          response: {
            201: projectDetailResponseSchema,
            ...errorResponses,
          },
        },
      },
      (request, reply) => controller.create(request, reply),
    );

    app.get(
      "/projects",
      {
        schema: {
          tags: ["Projetos"],
          summary: "Listar projetos acessíveis",
          security: [{ cookieAuth: [] }],
          response: {
            200: projectListResponseSchema,
            401: errorResponses[401],
          },
        },
      },
      (request) => controller.list(request),
    );

    app.get(
      "/me/projects",
      {
        schema: {
          tags: ["Me"],
          summary: "Listar projetos do usuário autenticado",
          security: [{ cookieAuth: [] }],
          response: {
            200: projectListResponseSchema,
            401: errorResponses[401],
          },
        },
      },
      (request) => controller.listMine(request),
    );

    app.get(
      "/projects/:id",
      {
        schema: {
          tags: ["Projetos"],
          summary: "Consultar detalhes do projeto",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          response: {
            200: projectDetailResponseSchema,
            ...errorResponses,
          },
        },
      },
      (request) => controller.get(request),
    );

    app.patch(
      "/projects/:id",
      {
        schema: {
          tags: ["Projetos"],
          summary: "Atualizar projeto",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          body: updateProjectBodySchema,
          response: {
            200: projectDetailResponseSchema,
            ...errorResponses,
          },
        },
      },
      (request) => controller.update(request),
    );

    app.get(
      "/projects/:id/members",
      {
        schema: {
          tags: ["Participantes"],
          summary: "Listar participantes do projeto",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          response: {
            200: projectMemberListResponseSchema,
            ...errorResponses,
          },
        },
      },
      (request) => controller.listMembers(request),
    );

    app.post(
      "/projects/:id/members",
      {
        schema: {
          tags: ["Participantes"],
          summary: "Adicionar participante",
          security: [{ cookieAuth: [] }],
          params: projectIdParamsSchema,
          body: addProjectMemberBodySchema,
          response: {
            201: projectMemberSchema,
            ...errorResponses,
          },
        },
      },
      (request, reply) => controller.addMember(request, reply),
    );

    app.patch(
      "/projects/:id/members/:memberId",
      {
        schema: {
          tags: ["Participantes"],
          summary: "Alterar função do participante",
          security: [{ cookieAuth: [] }],
          params: projectMemberParamsSchema,
          body: updateProjectMemberBodySchema,
          response: {
            200: projectMemberSchema,
            ...errorResponses,
          },
        },
      },
      (request) => controller.updateMember(request),
    );

    app.delete(
      "/projects/:id/members/:memberId",
      {
        schema: {
          tags: ["Participantes"],
          summary: "Remover participante",
          security: [{ cookieAuth: [] }],
          params: projectMemberParamsSchema,
          response: {
            204: z.undefined(),
            ...errorResponses,
          },
        },
      },
      (request, reply) => controller.removeMember(request, reply),
    );
  };
}
