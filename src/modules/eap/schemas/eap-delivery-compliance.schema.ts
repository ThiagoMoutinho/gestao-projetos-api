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

// ---------- Versões de entrega ----------

export const versionParamsSchema = z.object({ id: z.string().min(1), versionId: z.string().min(1) });

const personSchema = z.object({ id: z.string(), name: z.string().nullable() });

export const deliveryItemStatusSchema = z.enum(["PENDENTE", "ENVIADO", "APROVADO", "REJEITADO", "DISPENSADO"]);
export const deliveryEvidenceKindSchema = z.enum(["SHAREPOINT", "GITLAB_TAG", "GITLAB_RELEASE", "OUTRO"]);

export const deliveryVersionItemSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  documentType: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  required: z.boolean(),
  status: deliveryItemStatusSchema,
  evidenceKind: deliveryEvidenceKindSchema.nullable(),
  evidenceRef: z.string().nullable().describe("Link do SharePoint ou referência de tag/release do GitLab. O sistema não guarda arquivos."),
  submittedBy: personSchema.nullable(),
  submittedAt: z.string().nullable(),
  validator: personSchema.nullable().describe("Validador designado para o item; se vazio, vale o responsável técnico do marco."),
  decidedBy: personSchema.nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable().describe("Justificativa da rejeição ou da dispensa."),
});

export const deliveryConformitySchema = z.object({
  total: z.number().int(),
  required: z.number().int(),
  approved: z.number().int(),
  dispensed: z.number().int(),
  awaitingValidation: z.number().int(),
  pending: z.number().int(),
  rejected: z.number().int(),
  conforming: z.boolean().describe("Todos os documentos obrigatórios estão aprovados ou formalmente dispensados."),
  blockingItems: z.array(z.object({ id: z.string(), title: z.string(), status: deliveryItemStatusSchema })),
});

export const deliveryVersionSchema = z.object({
  id: z.string(),
  versionLabel: z.string().describe("Versão lógica do produto (1.0, 1.1, 2.0); não é a rodada de avaliação."),
  nature: deliveryNatureSchema,
  templateRevision: z.number().int().describe("Revisão do modelo cujos itens foram copiados para a versão."),
  templateIsProposal: z.boolean().describe("A revisão do modelo usada ainda é proposta sujeita à validação da CTIN."),
  notes: z.string().nullable(),
  createdBy: personSchema.nullable(),
  createdAt: z.string(),
  rounds: z.number().int().describe("Rodadas de avaliação (eap_milestone_deliveries) ligadas a esta versão."),
  conformity: deliveryConformitySchema,
  defaultValidators: z
    .array(personSchema)
    .describe("Responsáveis técnicos dos marcos de homologação: validam os documentos que não têm validador designado."),
  items: z.array(deliveryVersionItemSchema),
});

export const deliveryVersionListSchema = z.object({
  data: z.array(deliveryVersionSchema),
  summary: z.object({
    versions: z.number().int(),
    conforming: z.number().int(),
    nonConforming: z.number().int(),
    hasSupplier: z.boolean().describe("A Conformidade de Entrega se aplica a projetos com fornecedor."),
  }),
});

export const createDeliveryVersionBodySchema = z
  .object({
    versionLabel: z
      .string()
      .trim()
      .regex(/^[0-9]+(\.[0-9]+){0,2}$/, "Use o formato 1.0, 1.1 ou 2.0.")
      .describe("Versão do produto ou solução, por exemplo 1.0, 1.1 ou 2.0."),
    nature: deliveryNatureSchema,
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export type CreateDeliveryVersionBody = z.infer<typeof createDeliveryVersionBodySchema>;
export type DeliveryVersionDto = z.infer<typeof deliveryVersionSchema>;
export type DeliveryVersionItemDto = z.infer<typeof deliveryVersionItemSchema>;

// ---------- Envio e validação documental ----------

export const itemParamsSchema = z.object({ id: z.string().min(1), versionId: z.string().min(1), itemId: z.string().min(1) });

/** Normaliza a evidência: link do SharePoint (https) ou referência de tag/release do GitLab (nome ou link). Devolve null se inválida. */
export function normalizeEvidence(kind: string, reference: string): string | null {
  const ref = reference.trim();
  if (ref.length < 1 || ref.length > 1000) return null;
  const asUrl = (protocols: string[]) => {
    try {
      return protocols.includes(new URL(ref).protocol) ? ref : null;
    } catch {
      return null;
    }
  };
  switch (kind) {
    case "SHAREPOINT":
      return asUrl(["https:"]);
    case "OUTRO":
      return asUrl(["https:", "http:"]);
    case "GITLAB_TAG":
    case "GITLAB_RELEASE":
      return /^[A-Za-z0-9][A-Za-z0-9._\-/+]{0,199}$/.test(ref) ? ref : asUrl(["https:"]);
    default:
      return null;
  }
}

export const submitDeliveryItemBodySchema = z
  .object({
    evidenceKind: deliveryEvidenceKindSchema,
    evidenceRef: z.string().trim().min(1).max(1000).describe("Link do SharePoint ou tag/release do GitLab (nome ou link)."),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (normalizeEvidence(value.evidenceKind, value.evidenceRef) === null) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRef"],
        message:
          value.evidenceKind === "SHAREPOINT"
            ? "Informe o link (https) do SharePoint."
            : value.evidenceKind === "OUTRO"
              ? "Informe um link http ou https."
              : "Informe o nome da tag ou release do GitLab, ou o link dela.",
      });
    }
  });

export const approveDeliveryItemBodySchema = z.object({ note: z.string().trim().max(2000).nullable().optional() }).strict();

/** Rejeição e dispensa exigem justificativa formal de pelo menos 10 caracteres. */
export const reasonDeliveryItemBodySchema = z.object({ note: z.string().trim().min(10).max(2000) }).strict();

export const assignDeliveryValidatorBodySchema = z
  .object({ validatorId: z.string().min(1).nullable().describe("Participante do projeto (não fornecedor); nulo remove a designação.") })
  .strict();

export const deliveryItemEventListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      action: z
        .enum(["ENVIO", "APROVACAO", "REJEICAO", "DISPENSA", "DESIGNACAO"])
        .describe("DESIGNACAO: troca do validador do documento (vem da auditoria); as demais vêm do histórico do documento."),
      actor: personSchema.nullable(),
      actorRole: z.string().nullable().describe("Perfil global de quem agiu (ADMIN, PMO, GESTOR, FORNECEDOR...)."),
      actorProjectRoles: z.array(z.string()).describe("Papéis de quem agiu no projeto (DONO_PROJETO, FORNECEDOR, RESPONSAVEL_TECNICO...)."),
      previousValidator: personSchema.nullable().describe("DESIGNACAO: validador anterior (nulo: nenhum designado)."),
      newValidator: personSchema.nullable().describe("DESIGNACAO: novo validador (nulo: designação removida)."),
      evidenceKind: deliveryEvidenceKindSchema.nullable(),
      evidenceRef: z.string().nullable(),
      note: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export type SubmitDeliveryItemBody = z.infer<typeof submitDeliveryItemBodySchema>;
export type ApproveDeliveryItemBody = z.infer<typeof approveDeliveryItemBodySchema>;
export type ReasonDeliveryItemBody = z.infer<typeof reasonDeliveryItemBodySchema>;
export type AssignDeliveryValidatorBody = z.infer<typeof assignDeliveryValidatorBodySchema>;
