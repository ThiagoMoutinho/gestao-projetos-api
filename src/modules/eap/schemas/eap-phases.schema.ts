import { z } from "zod";

import { errorResponseSchema } from "../../../lib/http-error";

export const eapPhaseStatusSchema = z.enum([
  "NAO_INICIADA",
  "EM_ANDAMENTO",
  "CONCLUIDA",
  "SUSPENSA",
]);

export type EapPhaseStatus = z.infer<typeof eapPhaseStatusSchema>;

function requiredIsoDateTime(message: string) {
  return z
    .string(message)
    .min(1, message)
    .refine((value) => !Number.isNaN(Date.parse(value)), "Data inválida.");
}

export const projectIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const phaseParamsSchema = z.object({
  id: z.string().min(1),
  phaseId: z.string().min(1),
});

export const createPhaseBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(4000).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
    plannedStartAt: requiredIsoDateTime("Informe o início planejado."),
    plannedEndAt: requiredIsoDateTime("Informe o término planejado."),
    responsibleId: z.string().min(1).nullable().optional(),
    completionCriteria: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();

export const updatePhaseBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    suspended: z
      .boolean()
      .optional()
      .describe("Suspende ou retoma a fase. A situação de execução é calculada a partir das tarefas e marcos."),
    responsibleId: z.string().min(1).nullable().optional(),
    completionCriteria: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export const reorderPhasesBodySchema = z
  .object({
    items: z
      .array(
        z.object({
          phaseId: z.string().min(1),
          sortOrder: z.number().int().min(0),
        }),
      )
      .min(1),
  })
  .strict();

export const eapPhaseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  status: eapPhaseStatusSchema,
  responsibleId: z.string().nullable(),
  completionCriteria: z.string().nullable(),
  baselineStartAt: z.string().nullable(),
  baselineEndAt: z.string().nullable(),
  plannedStartAt: z.string().nullable(),
  plannedEndAt: z.string().nullable(),
  actualStartAt: z.string().nullable(),
  actualEndAt: z.string().nullable(),
  calculatedStatus: eapPhaseStatusSchema.describe(
    "Situação pela regra da EAP. Difere de status apenas em registros antigos ainda não reconciliados.",
  ),
  progressState: z.enum(["VALUE", "EMPTY", "NO_ELIGIBLE"]),
  progressBasisPoints: z
    .number()
    .int()
    .nullable()
    .describe("Andamento consolidado em centésimos de ponto percentual (6625 = 66,25%)."),
  createdBy: z.string(),
  updatedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const eapPhaseListResponseSchema = z.object({
  data: z.array(eapPhaseSchema),
  summary: z.object({
    progressBasisPoints: z.number().int().nullable(),
    coverageBasisPoints: z.number().int().nullable(),
  }),
});

export const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
};
