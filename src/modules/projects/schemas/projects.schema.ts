import { z } from "zod";

import { errorResponseSchema } from "../../../lib/http-error";

export const projectStatusSchema = z.enum([
  "NAO_INICIADO",
  "EM_EXECUCAO",
  "EM_ATENCAO",
  "CRITICO",
  "EM_VALIDACAO",
  "CONCLUIDO",
  "SUSPENSO",
]);

export const projectMemberRoleSchema = z.enum([
  "DONO_PROJETO",
  "GESTOR",
  "PO",
  "DESENVOLVEDOR",
  "RESPONSAVEL_TECNICO",
  "FORNECEDOR",
  "OBSERVADOR",
]);

export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type ProjectMemberRole = z.infer<typeof projectMemberRoleSchema>;

export const projectIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const projectMemberParamsSchema = z.object({
  id: z.string().min(1),
  memberId: z.string().min(1),
});

export const createProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(4000).nullable().optional(),
  glpiTicketId: z.string().trim().max(50).nullable().optional(),
  ownerId: z.string().min(1).optional(),
  status: projectStatusSchema.optional(),
});

export const updateProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    glpiTicketId: z.string().trim().max(50).nullable().optional(),
    ownerId: z.string().min(1).optional(),
    status: projectStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export const addProjectMemberBodySchema = z.object({
  userId: z.string().min(1),
  role: projectMemberRoleSchema,
});

export const updateProjectMemberBodySchema = z.object({
  role: projectMemberRoleSchema,
});

export const userSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
});

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  glpiTicketId: z.string().nullable(),
  ownerId: z.string(),
  status: projectStatusSchema,
  baselineStartAt: z.string().nullable().describe("Início do planejamento original."),
  baselineEndAt: z.string().nullable().describe("Término do planejamento original."),
  plannedStartAt: z.string().nullable().describe("Início planejado vigente."),
  plannedEndAt: z.string().nullable().describe("Término planejado vigente."),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const projectListItemSchema = projectSchema.extend({
  isOwner: z.boolean(),
  roles: z.array(projectMemberRoleSchema),
});

export const projectDetailSchema = projectSchema.extend({
  owner: userSummarySchema,
  isOwner: z.boolean(),
  roles: z.array(projectMemberRoleSchema),
});

export const projectMemberSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  userId: z.string(),
  role: projectMemberRoleSchema,
  createdAt: z.string(),
  user: userSummarySchema,
});

export const projectListResponseSchema = z.object({
  data: z.array(projectListItemSchema),
});

export const projectDetailResponseSchema = projectDetailSchema;

export const projectMemberListResponseSchema = z.object({
  data: z.array(projectMemberSchema),
});

export const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
};
