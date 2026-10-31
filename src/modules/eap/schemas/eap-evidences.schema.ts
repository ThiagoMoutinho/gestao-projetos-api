import { z } from "zod";

import { errorResponseSchema } from "../../../lib/http-error";
import { EVIDENCE_KINDS } from "../dtos/eap-evidences.dto";

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

const evidenceKindSchema = z.enum(EVIDENCE_KINDS);

/** Número do chamado GLPI: só dígitos (aceita o "#" na frente, que é descartado). */
const ticketNumberSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^#/, ""))
  .pipe(z.string().regex(/^[0-9]{1,12}$/, "Informe apenas os números do chamado GLPI."));

function parentCount(value: {
  phaseId?: string;
  taskId?: string;
  milestoneId?: string;
  scheduleRequestId?: string;
  projectLevel?: true;
}) {
  return [value.phaseId, value.taskId, value.milestoneId, value.scheduleRequestId, value.projectLevel].filter(
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
    /** Obrigatório, exceto para Chamado GLPI (sem título, usa "GLPI #número"). */
    title: z.string().trim().min(1).max(255).optional(),
    url: httpUrlSchema,
    kind: evidenceKindSchema.optional(),
    ticketNumber: ticketNumberSchema.optional(),
    phaseId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    milestoneId: z.string().min(1).optional(),
    scheduleRequestId: z.string().min(1).optional(),
    /** Evidência ou referência vinculada diretamente ao projeto (ex.: documento no SharePoint). */
    projectLevel: z.literal(true).optional(),
  })
  .strict()
  .refine((value) => parentCount(value) === 1, {
    message:
      "Informe exatamente um vínculo: projeto, fase, tarefa, marco ou solicitação de reprogramação.",
  })
  .refine((value) => value.kind !== "GLPI_TICKET" || value.ticketNumber !== undefined, {
    message: "Informe o número do chamado GLPI.",
    path: ["ticketNumber"],
  })
  .refine((value) => value.kind === "GLPI_TICKET" || value.ticketNumber === undefined, {
    message: "O número do chamado só se aplica ao tipo Chamado GLPI.",
    path: ["ticketNumber"],
  })
  .refine((value) => value.kind === "GLPI_TICKET" || value.title !== undefined, {
    message: "Informe o título da evidência.",
    path: ["title"],
  });

export const updateEvidenceBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    url: httpUrlSchema.optional(),
    kind: evidenceKindSchema.optional(),
    ticketNumber: ticketNumberSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  })
  .refine((value) => value.kind === undefined || value.kind === "GLPI_TICKET" || value.ticketNumber === undefined, {
    message: "O número do chamado só se aplica ao tipo Chamado GLPI.",
    path: ["ticketNumber"],
  });

export const eapEvidenceSchema = z.object({
  id: z.string(),
  phaseId: z.string().nullable(),
  taskId: z.string().nullable(),
  milestoneId: z.string().nullable(),
  scheduleRequestId: z.string().nullable(),
  projectId: z.string().nullable(),
  projectResultId: z.string().nullable(),
  title: z.string(),
  url: z.string(),
  kind: evidenceKindSchema.nullable(),
  ticketNumber: z.string().nullable(),
  deliveryId: z.string().nullable(),
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
