import { z } from "zod";

import { errorResponseSchema } from "../../../lib/http-error";

export const eapTaskStatusSchema = z.enum([
  "NAO_INICIADA",
  "EM_ANDAMENTO",
  "IMPEDIDA",
  "CONCLUIDA",
  "CANCELADA",
]);

export type EapTaskStatus = z.infer<typeof eapTaskStatusSchema>;

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Data inválida.",
  });

function requiredIsoDateTime(message: string) {
  return z
    .string(message)
    .min(1, message)
    .refine((value) => !Number.isNaN(Date.parse(value)), "Data inválida.");
}

export const taskParamsSchema = z.object({
  id: z.string().min(1),
  phaseId: z.string().min(1),
  taskId: z.string().min(1),
});

export const createTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(4000).nullable().optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    weight: z.number().int().min(1).optional(),
    plannedStartAt: requiredIsoDateTime("Informe o início planejado."),
    plannedEndAt: requiredIsoDateTime("Informe o término planejado."),
    correctiveMilestoneId: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("Marco da mesma fase com correções pendentes que a tarefa atende."),
  })
  .strict();

export const updateTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    weight: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export const updateTaskProgressBodySchema = z
  .object({
    progressPercent: z
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .describe("A situação é derivada: 0% não iniciada, 1–99% em andamento, 100% concluída."),
    actualStartAt: isoDateTimeSchema.nullable().optional(),
    actualEndAt: isoDateTimeSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export const taskStatusDecisionBodySchema = z
  .object({
    justification: z.string().trim().min(10).max(2000),
  })
  .strict();

export const eapTaskSchema = z.object({
  id: z.string(),
  phaseId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  assigneeId: z.string().nullable(),
  status: eapTaskStatusSchema,
  progressPercent: z.number().int(),
  weight: z.number().int(),
  baselineStartAt: z.string().nullable(),
  baselineEndAt: z.string().nullable(),
  plannedStartAt: z.string().nullable(),
  plannedEndAt: z.string().nullable(),
  actualStartAt: z.string().nullable(),
  actualEndAt: z.string().nullable(),
  hasImpediment: z.boolean(),
  correctiveMilestoneId: z.string().nullable(),
  calculatedStatus: eapTaskStatusSchema.describe(
    "Situação pela regra da EAP. Difere de status apenas em registros antigos ainda não reconciliados.",
  ),
  createdBy: z.string(),
  updatedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const reorderTasksBodySchema = z
  .object({
    items: z
      .array(
        z.object({
          taskId: z.string().min(1),
          sortOrder: z.number().int().min(0),
        }),
      )
      .min(1),
  })
  .strict();

export const eapTaskListResponseSchema = z.object({
  data: z.array(eapTaskSchema),
});

export const taskErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
};
