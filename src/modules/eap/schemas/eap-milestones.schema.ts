import { z } from "zod";

import { errorResponseSchema } from "../../../lib/http-error";

export const eapMilestoneTypeSchema = z.enum(["ENTREGA", "APROVACAO", "HOMOLOGACAO"]);
export const eapMilestoneStatusSchema = z.enum([
  "PENDENTE",
  "ENTREGUE",
  "APROVADO",
  "REJEITADO",
  "AJUSTES_SOLICITADOS",
]);
export const eapMilestoneDecisionSchema = z.enum(["APROVADO", "AJUSTES_SOLICITADOS", "REJEITADO"]);
export const eapMilestoneDeliveryStatusSchema = z.enum([
  "EM_ANALISE",
  "ACEITA",
  "AJUSTES_SOLICITADOS",
  "REJEITADA",
]);

export type EapMilestoneType = z.infer<typeof eapMilestoneTypeSchema>;
export type EapMilestoneStatus = z.infer<typeof eapMilestoneStatusSchema>;
export type EapMilestoneDecision = z.infer<typeof eapMilestoneDecisionSchema>;

function requiredIsoDateTime(message: string) {
  return z
    .string(message)
    .min(1, message)
    .refine((value) => !Number.isNaN(Date.parse(value)), "Data inválida.");
}

export const milestoneParamsSchema = z.object({
  id: z.string().min(1),
  phaseId: z.string().min(1),
  milestoneId: z.string().min(1),
});

export const createMilestoneBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(4000).nullable().optional(),
    type: eapMilestoneTypeSchema,
    plannedAt: requiredIsoDateTime("Informe a data planejada."),
    reviewerId: z.string().min(1).nullable().optional(),
  })
  .strict();

export const updateMilestoneBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    reviewerId: z.string().min(1).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export const deliverMilestoneBodySchema = z
  .object({
    note: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();

export const reviewMilestoneBodySchema = z
  .object({
    decision: eapMilestoneDecisionSchema,
    note: z.string().trim().max(4000).nullable().optional(),
    nonconformities: z.string().trim().max(4000).nullable().optional(),
    adjustments: z.string().trim().max(4000).nullable().optional(),
    evidences: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(255),
            url: z.string().trim().url().max(2048),
          })
          .strict(),
      )
      .max(10)
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.decision === "APROVADO" ||
      (typeof value.note === "string" && value.note.trim().length >= 10),
    {
      message: "A rejeição e a solicitação de ajustes exigem justificativa com ao menos 10 caracteres.",
      path: ["note"],
    },
  );

export const authorizeResubmissionBodySchema = z
  .object({
    justification: z.string().trim().min(10).max(4000),
  })
  .strict();

export const eapMilestoneSchema = z.object({
  id: z.string(),
  phaseId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  type: eapMilestoneTypeSchema,
  status: eapMilestoneStatusSchema,
  baselineAt: z.string().nullable(),
  plannedAt: z.string().nullable(),
  actualAt: z.string().nullable(),
  deliveredBy: z.string().nullable(),
  validatedBy: z.string().nullable(),
  validationNote: z.string().nullable(),
  validatedAt: z.string().nullable(),
  reviewerId: z.string().nullable(),
  createdBy: z.string(),
  updatedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const eapMilestoneDeliverySchema = z.object({
  id: z.string(),
  milestoneId: z.string(),
  round: z.number().int(),
  legacy: z.boolean(),
  status: eapMilestoneDeliveryStatusSchema,
  submittedBy: z.string(),
  submittedByName: z.string().nullable(),
  submittedAt: z.string().nullable(),
  note: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  nonconformities: z.string().nullable(),
  adjustments: z.string().nullable(),
  resubmissionAuthorizedBy: z.string().nullable(),
  resubmissionAuthorizedByName: z.string().nullable(),
  resubmissionAuthorizedAt: z.string().nullable(),
  resubmissionNote: z.string().nullable(),
});

export const eapMilestoneDeliveryListResponseSchema = z.object({
  data: z.array(eapMilestoneDeliverySchema),
});

export const reorderMilestonesBodySchema = z
  .object({
    items: z
      .array(
        z.object({
          milestoneId: z.string().min(1),
          sortOrder: z.number().int().min(0),
        }),
      )
      .min(1),
  })
  .strict();

export const eapMilestoneListResponseSchema = z.object({
  data: z.array(eapMilestoneSchema),
});

export const milestoneErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
};
