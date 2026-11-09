import { z } from "zod";

import { errorResponseSchema } from "../../../lib/http-error";
import { DELIVERY_NATURES } from "../repositories/delivery-compliance.contract";

export const complianceErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
};

export const deliveryNatureSchema = z.enum(DELIVERY_NATURES).describe("SISTEMAS, INFRAESTRUTURA ou PROCESSOS.");
export const natureParamsSchema = z.object({ nature: deliveryNatureSchema });

/** Item do modelo de checklist. */
export const checklistItemSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  documentType: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  required: z.boolean(),
});

export const checklistRevisionSchema = z.object({
  id: z.string(),
  revision: z.number().int(),
  status: z.enum(["RASCUNHO", "PUBLICADA"]),
  isProposal: z.boolean().describe("Proposta sujeita à validação da CTIN."),
  sourceNote: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  publishedBy: z.string().nullable(),
  publishedAt: z.string().nullable(),
  items: z.array(checklistItemSchema),
});

export const checklistTemplateSchema = z.object({
  nature: deliveryNatureSchema,
  name: z.string(),
  published: checklistRevisionSchema.nullable().describe("Última revisão publicada (a usada em novas versões de entrega)."),
  draft: checklistRevisionSchema.nullable().describe("Rascunho em edição; só aparece para ADMIN e PMO."),
  revisions: z.array(
    z.object({
      revision: z.number().int(),
      status: z.enum(["RASCUNHO", "PUBLICADA"]),
      isProposal: z.boolean(),
      publishedAt: z.string().nullable(),
    }),
  ),
});

export const checklistTemplateListSchema = z.object({ data: z.array(checklistTemplateSchema) });

const itemInputSchema = z
  .object({
    documentType: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_]{2,60}$/, "Use letras maiúsculas, números e sublinhado (2 a 60 caracteres)."),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(1000).nullable().optional(),
    required: z.boolean().default(true),
  })
  .strict();

export const saveChecklistDraftBodySchema = z
  .object({
    items: z.array(itemInputSchema).min(1).max(60),
    notes: z.string().trim().max(2000).nullable().optional(),
    sourceNote: z.string().trim().max(2000).nullable().optional(),
    ctinValidated: z
      .boolean()
      .optional()
      .describe("true confirma a validação da CTIN e retira a marca de proposta; sem isso a marca da revisão anterior é mantida."),
  })
  .strict();

export type SaveChecklistDraftBody = z.infer<typeof saveChecklistDraftBodySchema>;
export type ChecklistRevisionDto = z.infer<typeof checklistRevisionSchema>;
export type ChecklistTemplateDto = z.infer<typeof checklistTemplateSchema>;
