import { z } from "zod";

import { errorResponseSchema } from "../../../lib/http-error";

const httpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Informe um link http ou https.");

function parentCount(value: {
  phaseId?: string;
  taskId?: string;
  milestoneId?: string;
  scheduleRequestId?: string;
}) {
  return [value.phaseId, value.taskId, value.milestoneId, value.scheduleRequestId].filter(
    (item) => item != null,
  ).length;
}

export const evidenceParamsSchema = z.object({
  id: z.string().min(1),
  evidenceId: z.string().min(1),
});

export const listEvidencesQuerySchema = z
  .object({
    phaseId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    milestoneId: z.string().min(1).optional(),
    scheduleRequestId: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => parentCount(value) <= 1, {
    message: "Informe no máximo um vínculo.",
  });

export const createEvidenceBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    url: httpUrlSchema,
    phaseId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    milestoneId: z.string().min(1).optional(),
    scheduleRequestId: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => parentCount(value) === 1, {
    message:
      "Informe exatamente um vínculo: fase, tarefa, marco ou solicitação de reprogramação.",
  });

export const updateEvidenceBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    url: httpUrlSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export const eapEvidenceSchema = z.object({
  id: z.string(),
  phaseId: z.string().nullable(),
  taskId: z.string().nullable(),
  milestoneId: z.string().nullable(),
  scheduleRequestId: z.string().nullable(),
  title: z.string(),
  url: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});

export const eapEvidenceListResponseSchema = z.object({
  data: z.array(eapEvidenceSchema),
});

export const evidenceErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
};
