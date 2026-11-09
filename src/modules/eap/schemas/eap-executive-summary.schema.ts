import { z } from "zod";

import { projectSituationSchema } from "./eap-schedule.schema";

/**
 * Resumo executivo automático: retrato dos indicadores do projeto no momento da consulta, montado só com dados
 * existentes e frases predefinidas. Nada é gravado e nenhum texto é interpretado ou inventado.
 */
export const executiveSummaryKindSchema = z.enum(["REGULAR", "EXTRAORDINARY"]);

export const executiveSummaryValidationItemSchema = z.object({
  id: z.string(),
  kind: executiveSummaryKindSchema,
  cycleStart: z.string(),
  cycleEnd: z.string(),
  validatedAt: z.string(),
  validatedById: z.string(),
  validatedByName: z.string().nullable(),
  observation: z.string().nullable(),
  /** Validação "sem alterações": indicadores iguais aos da validação anterior, conferido no servidor. */
  unchanged: z.boolean(),
});

const executiveSummaryBaseShape = {
  /** Data e hora de referência dos dados (momento da consulta). */
  generatedAt: z.string(),
  /** Falso quando o projeto ainda não tem fases com itens: não há dados suficientes para sintetizar. */
  hasData: z.boolean(),
  situation: projectSituationSchema,
  progress: z.object({
    basisPoints: z.number().int().nullable(),
    coverageBasisPoints: z.number().int().nullable(),
    phasesTotal: z.number().int(),
    phasesCalculated: z.number().int(),
  }),
  overdue: z.object({
    phases: z.number().int(),
    tasks: z.number().int(),
    milestones: z.number().int(),
    total: z.number().int(),
  }),
  impediments: z.number().int(),
  reschedules: z.object({
    total: z.number().int(),
    escalated: z.number().int(),
    affectingCriticalMilestones: z.number().int(),
  }),
  homologation: z.object({
    awaiting: z.number().int(),
    inCorrections: z.number().int(),
    rejected: z.number().int(),
  }),
  nextDeliveries: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      plannedAt: z.string(),
      overdue: z.boolean(),
      corrections: z.boolean(),
      phaseId: z.string(),
      phaseName: z.string().nullable(),
    }),
  ),
  movements: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      actorName: z.string().nullable(),
      kind: z.string(),
      automatic: z.boolean(),
      summary: z.string(),
      /** Entrada de governança: omitida do histórico para quem não pode consultá-la. */
      governance: z.boolean(),
    }),
  ),
  narrative: z.array(z.object({ key: z.string(), text: z.string() })),
};

const followUpStateSchema = z.enum(["AGUARDANDO_VALIDACAO", "VALIDADO", "ENCERRADO_SEM_VALIDACAO", "FORA_DO_ACOMPANHAMENTO", "INDETERMINADO"]);
const followUpReasonSchema = z.enum([
  "NAO_INICIADO",
  "SUSPENSO",
  "CONCLUIDO",
  "CICLO_PARCIAL",
  "ANTES_DO_CORTE",
  "STATUS_SEM_HISTORICO",
  "INICIO_NAO_COMPROVADO",
]);

/**
 * Acompanhamento semanal da validação (cálculo somente de leitura; não grava, não notifica e não escalona).
 * Ausência de validação não significa ausência de atualização do projeto: os indicadores automáticos seguem à parte.
 */
export const executiveFollowUpSchema = z.object({
  /** Falso enquanto o corte de ativação estiver desabilitado: o acompanhamento é só informativo e não gera pendência. */
  operational: z.boolean(),
  /** Estado do ciclo atual (que está aberto até a quarta-feira). */
  state: followUpStateSchema,
  reason: followUpReasonSchema.nullable(),
  currentCycle: z.object({ start: z.string(), end: z.string(), deadlineAt: z.string() }),
  /** Último ciclo já encerrado. */
  previousCycle: z.object({ start: z.string(), end: z.string(), state: followUpStateSchema, reason: followUpReasonSchema.nullable() }),
  /** Ciclos encerrados, elegíveis e sem validação regular, em sequência contínua até o ciclo anterior. */
  unvalidatedSequence: z
    .object({
      length: z.number().int(),
      firstCycleStart: z.string(),
      lastCycleStart: z.string(),
      cycles: z.array(z.object({ start: z.string(), end: z.string() })),
    })
    .nullable(),
  escalation: z.object({
    status: z.enum(["NAO_APLICAVEL", "AINDA_NAO_ELEGIVEL", "ELEGIVEL", "INDETERMINADO"]),
    eligibleAt: z.string().nullable(),
    /** Anos do calendário institucional sem validação do ADMIN, quando o cálculo depende deles. */
    calendarPendingYears: z.array(z.number().int()),
  }),
});

/** Governança da validação do PMO, separada dos indicadores automáticos. */
export const executiveGovernanceSchema = z.object({
  followUp: executiveFollowUpSchema,
  cycle: z.object({ start: z.string(), end: z.string(), deadlineAt: z.string() }),
  /** Falso para projetos concluídos ou suspensos: ficam fora das cobranças periódicas (validação manual continua possível). */
  periodic: z.boolean(),
  currentCycleRegularValidated: z.boolean(),
  lastValidation: executiveSummaryValidationItemSchema.nullable(),
  /** Só o perfil global PMO valida. */
  canValidate: z.boolean(),
  /** Impressão digital do conteúdo atual; o cliente devolve na validação para o servidor detectar mudanças. */
  fingerprint: z.string(),
  /** Os indicadores atuais são iguais aos da última validação (permite "Validar sem alterações"). */
  unchangedSinceLastValidation: z.boolean(),
});

export const executiveSummarySchema = z.object({
  ...executiveSummaryBaseShape,
  governance: executiveGovernanceSchema,
});

export type ExecutiveSummaryDto = z.infer<typeof executiveSummarySchema>;
export type ExecutiveSummaryValidationItemDto = z.infer<typeof executiveSummaryValidationItemSchema>;

export const validateExecutiveSummaryBodySchema = z
  .object({
    observation: z.string().trim().max(2000).optional(),
    /** Validação extraordinária (adicional à regular do ciclo): exige observação. */
    extraordinary: z.boolean().optional(),
    /** "Validar sem alterações": só vale se os indicadores forem iguais aos da validação anterior. */
    withoutChanges: z.boolean().optional(),
    /** Impressão digital vista pelo PMO na tela; se mudou, a validação é recusada (409). */
    fingerprint: z.string().min(1).max(128),
  })
  .strict()
  .refine((value) => !value.extraordinary || (value.observation ?? "").length > 0, {
    message: "A validação extraordinária exige observação.",
    path: ["observation"],
  });

export const executiveSummaryValidationParamsSchema = z.object({ id: z.string().min(1), validationId: z.string().min(1) });

export const listExecutiveSummaryValidationsQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).optional() })
  .strict();

export const executiveSummaryValidationListSchema = z.object({ data: z.array(executiveSummaryValidationItemSchema) });

/** Snapshot consultado: os mesmos campos do resumo no momento da validação (sem o bloco de governança atual). */
export const executiveSummarySnapshotSchema = z.object(executiveSummaryBaseShape);

export const executiveSummaryValidationDetailSchema = executiveSummaryValidationItemSchema.extend({
  snapshot: executiveSummarySnapshotSchema,
});
export type ExecutiveSummarySnapshotDto = z.infer<typeof executiveSummarySnapshotSchema>;
