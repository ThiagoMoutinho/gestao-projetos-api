import { z } from "zod";

import { errorResponseSchema } from "../../../lib/http-error";

export const eapMilestoneTypeSchema = z.enum(["ENTREGA", "APROVACAO"]);
export const eapMilestoneStatusSchema = z.enum([
  "PENDENTE",
  "ENTREGUE",
  "APROVADO",
  "REJEITADO",
]);
export const eapMilestoneDecisionSchema = z.enum(["APROVADO", "REJEITADO"]);

export type EapMilestoneType = z.infer<typeof eapMilestoneTypeSchema>;
export type EapMilestoneStatus = z.infer<typeof eapMilestoneStatusSchema>;
export type EapMilestoneDecision = z.infer<typeof eapMilestoneDecisionSchema>;

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Data inválida.",
  });

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
    plannedAt: isoDateTimeSchema.nullable().optional(),
  })
  .strict();

export const updateMilestoneBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export const deliverMilestoneBodySchema = z.object({}).strict();

export const reviewMilestoneBodySchema = z
  .object({
    decision: eapMilestoneDecisionSchema,
    note: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.decision !== "REJEITADO" ||
      (typeof value.note === "string" && value.note.trim().length >= 10),
    {
      message: "A rejeição exige justificativa com ao menos 10 caracteres.",
      path: ["note"],
    },
  );

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
  createdBy: z.string(),
  updatedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
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
