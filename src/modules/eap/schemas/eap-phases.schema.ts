import { z } from "zod";

import { errorResponseSchema } from "../../../lib/http-error";

export const eapPhaseStatusSchema = z.enum([
  "NAO_INICIADA",
  "EM_ANDAMENTO",
  "CONCLUIDA",
  "SUSPENSA",
]);

export type EapPhaseStatus = z.infer<typeof eapPhaseStatusSchema>;

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
    responsibleId: z
      .string("Designe o responsável pela fase.")
      .min(1, "Designe o responsável pela fase.")
      .describe("Responsável pela fase, obrigatório na criação: participante do projeto."),
    completionCriteria: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()
  .describe("As datas da fase não são informadas: são calculadas pelas tarefas e marcos vinculados.");

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Data inválida.",
  });

export const updatePhaseBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    suspended: z
      .boolean()
      .optional()
      .describe("Suspende ou retoma a fase. A situação de execução é calculada a partir das tarefas e marcos."),
    justification: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .optional()
      .describe("Obrigatória (mín. 10 caracteres) para suspender a fase ou corrigir suas datas reais."),
    responsibleId: z.string().min(1).nullable().optional(),
    completionCriteria: z.string().trim().max(4000).nullable().optional(),
    actualStartAt: isoDateTimeSchema
      .nullable()
      .optional()
      .describe("Correção explícita do início real registrado (gestão do projeto, PMO ou administração)."),
    actualEndAt: isoDateTimeSchema
      .nullable()
      .optional()
      .describe("Correção explícita do término real registrado; só para fase concluída."),
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
  consolidatedStartAt: z
    .string()
    .nullable()
    .describe("Início indicado pelos itens (menor início planejado das tarefas). Não substitui o planejamento da fase."),
  consolidatedEndAt: z
    .string()
    .nullable()
    .describe("Término indicado pelos itens (maior término entre tarefas e marcos). Não substitui o planejamento da fase."),
  actualStartAt: z.string().nullable().describe("Início real registrado na fase."),
  actualEndAt: z.string().nullable().describe("Término real registrado na fase."),
  consolidatedActualStartAt: z
    .string()
    .nullable()
    .describe("Início real indicado pelos itens (menor início real das tarefas). Não substitui o registro da fase."),
  consolidatedActualEndAt: z
    .string()
    .nullable()
    .describe("Término real indicado pelos itens, só com a fase concluída. Não substitui o registro da fase."),
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
