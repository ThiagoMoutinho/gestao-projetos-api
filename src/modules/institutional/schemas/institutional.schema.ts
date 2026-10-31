import { z } from "zod";

import { errorResponseSchema } from "../../../lib/http-error";
import { eapEvidenceSchema } from "../../eap/schemas/eap-evidences.schema";
import { projectStatusSchema } from "../../projects/schemas/projects.schema";

export const PROFILE_FIELDS = [
  "PURPOSE",
  "SCOPE",
  "PROBLEM",
  "REQUESTING_AREA",
  "RESPONSIBLE_COMPANY",
  "BENEFITED_SECTORS",
  "SYSTEM_DESCRIPTION",
  "RESULTS_SUMMARY",
] as const;

export const profileFieldSchema = z.enum(PROFILE_FIELDS);
export const resultTypeSchema = z.enum(["ESPERADO", "ALCANCADO"]);

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Data inválida." });

export const profileParamsSchema = z.object({ id: z.string().min(1), field: profileFieldSchema });
export const resultParamsSchema = z.object({ id: z.string().min(1), resultId: z.string().min(1) });
export const highlightParamsSchema = z.object({ id: z.string().min(1), milestoneId: z.string().min(1) });

export const saveProfileBodySchema = z.object({ value: z.string().trim().min(1).max(8000) }).strict();

export const decisionBodySchema = z
  .object({
    decision: z.enum(["VALIDATE", "REJECT"]),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine((value) => value.decision === "VALIDATE" || Boolean(value.reason), {
    message: "Informe o motivo da rejeição.",
    path: ["reason"],
  });

const detailText = z.string().trim().max(1000).nullable().optional();

/** Meta, indicador, prazo previsto (esperado), valor obtido e observações (alcançado); todos opcionais. */
export const resultDetailsSchema = z
  .object({
    target: detailText,
    indicator: detailText,
    dueDate: isoDateTimeSchema.nullable().optional(),
    obtainedValue: detailText,
    observation: detailText,
  })
  .strict();

export const createResultBodySchema = z
  .object({
    type: resultTypeSchema,
    text: z.string().trim().min(1).max(2000),
    resultDate: isoDateTimeSchema.nullable().optional(),
    milestoneId: z.string().min(1).nullable().optional(),
    details: resultDetailsSchema.nullable().optional(),
    unforeseen: z.boolean().optional().describe("Alcançado não previsto entre os esperados."),
    expectedIds: z.array(z.string().min(1)).max(50).optional().describe("Esperados que este alcançado afere."),
  })
  .strict();

export const updateResultBodySchema = z
  .object({
    text: z.string().trim().min(1).max(2000).optional(),
    resultDate: isoDateTimeSchema.nullable().optional(),
    milestoneId: z.string().min(1).nullable().optional(),
    details: resultDetailsSchema.nullable().optional(),
    unforeseen: z.boolean().optional(),
    expectedIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos um campo para atualizar." });

const versionStatusSchema = z.enum(["EMPTY", "VALIDATED", "PENDING_VALIDATION"]);
const personSchema = z.object({ id: z.string(), name: z.string().nullable() });

const publishedMetaSchema = z.object({
  author: personSchema,
  authoredAt: z.string(),
  validatedBy: personSchema.nullable(),
  validatedAt: z.string().nullable(),
});

/** Resultados sempre têm validador; só os campos de preenchimento direto do perfil podem não ter. */
const validatedMetaSchema = z.object({
  author: personSchema,
  authoredAt: z.string(),
  validatedBy: personSchema,
  validatedAt: z.string(),
});

const draftMetaSchema = z.object({ author: personSchema, savedAt: z.string() });

export const profileFieldViewSchema = z.object({
  field: profileFieldSchema,
  status: versionStatusSchema,
  published: publishedMetaSchema.extend({ value: z.string() }).nullable(),
  /** Rascunho aguardando validação: só é enviado a quem pode editar ou validar. */
  draft: draftMetaSchema.extend({ value: z.string() }).nullable(),
});

const milestoneRefSchema = z.object({ id: z.string(), title: z.string() });

const resultDetailsViewSchema = z.object({
  target: z.string().nullable(),
  indicator: z.string().nullable(),
  dueDate: z.string().nullable(),
  obtainedValue: z.string().nullable(),
  observation: z.string().nullable(),
});

const resultContentSchema = z.object({
  text: z.string(),
  resultDate: z.string().nullable(),
  milestone: milestoneRefSchema.nullable(),
  details: resultDetailsViewSchema.nullable(),
});

const resultStatusSchema = z.enum(["EMPTY", "VALIDATED", "PENDING_VALIDATION", "CORRECTIONS_REQUESTED"]);

export const projectResultViewSchema = z.object({
  id: z.string(),
  type: resultTypeSchema,
  status: resultStatusSchema,
  createdAt: z.string(),
  createdBy: personSchema,
  /** Esperados são publicados direto: sem validador. */
  published: publishedMetaSchema.extend({ content: resultContentSchema }).nullable(),
  draft: draftMetaSchema.extend({ content: resultContentSchema }).nullable(),
  unforeseen: z.boolean(),
  correction: z.object({ reason: z.string(), by: personSchema, at: z.string() }).nullable(),
  /** Esperados que este alcançado afere (só em alcançados). */
  expected: z.array(z.object({ id: z.string(), text: z.string() })),
  /** Quantas aferições alcançadas se vinculam a este esperado (só em esperados). */
  achievedCount: z.number().int(),
});

export const evolutionViewSchema = z.object({
  milestoneId: z.string(),
  title: z.string(),
  phaseId: z.string(),
  phaseName: z.string(),
  type: z.string(),
  status: z.string(),
  plannedAt: z.string().nullable(),
  actualAt: z.string().nullable(),
  validatedAt: z.string().nullable(),
  highlighted: z.boolean(),
  highlightOrder: z.number().nullable(),
});

const glpiTicketSchema = z.object({
  ticketId: z.string(),
  /** Só existe quando a URL base do GLPI está configurada e o número do chamado é válido. */
  url: z.string().nullable(),
});

export const projectOverviewSchema = z.object({
  project: z.object({ id: z.string(), name: z.string(), status: projectStatusSchema }),
  origin: z.object({
    glpiTicket: glpiTicketSchema.nullable(),
    pmoGlpiTicket: glpiTicketSchema.nullable(),
    requestingArea: profileFieldViewSchema,
  }),
  responsible: z.object({ owner: personSchema, managers: z.array(personSchema), suppliers: z.array(personSchema) }),
  profile: z.object({
    systemDescription: profileFieldViewSchema,
    resultsSummary: profileFieldViewSchema,
    purpose: profileFieldViewSchema,
    scope: profileFieldViewSchema,
    problem: profileFieldViewSchema,
    responsibleCompany: profileFieldViewSchema,
    benefitedSectors: profileFieldViewSchema,
  }),
  results: z.object({ expected: z.array(projectResultViewSchema), achieved: z.array(projectResultViewSchema) }),
  evolutions: z.array(evolutionViewSchema),
  evidences: z.array(eapEvidenceSchema),
  permissions: z.object({
    canEdit: z.boolean(),
    canValidate: z.boolean(),
    /** Cadastrar resultados: inclui fornecedor vinculado e COORDENADOR. */
    canRegisterResults: z.boolean(),
    /** Validar alcançados: PMO, COORDENADOR e gestor do projeto (nunca fornecedor nem ADMIN por perfil). */
    canValidateResults: z.boolean(),
    /** Fornecedor altera somente os resultados que cadastrou. */
    ownResultsOnly: z.boolean(),
  }),
});

export const highlightResponseSchema = z.object({
  milestoneId: z.string(),
  highlightedBy: z.string(),
  highlightedAt: z.string(),
  sortOrder: z.number(),
});

export const institutionalErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
};

export const resultEvidenceBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    url: z.string().trim().min(1).max(2000),
  })
  .strict();
