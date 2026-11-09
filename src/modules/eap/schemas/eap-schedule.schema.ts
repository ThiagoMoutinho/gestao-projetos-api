import { z } from "zod";

import { errorResponseSchema } from "../../../lib/http-error";
import { DEADLINE_PERFORMANCES, type DeadlinePerformance } from "../use-cases/eap-status";

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Data inválida.",
  });

const justificationSchema = z
  .string()
  .trim()
  .max(4000)
  .nullable()
  .optional()
  .describe("Obrigatória (mínimo de 10 caracteres) quando altera data já planejada.");

export const rescheduleRangeBodySchema = z
  .object({
    plannedStartAt: isoDateTimeSchema,
    plannedEndAt: isoDateTimeSchema,
    justification: justificationSchema,
    extendPhase: z
      .boolean()
      .optional()
      .describe("Estende o planejamento da fase para cobrir o item, com a mesma justificativa (ajuste em cascata)."),
  })
  .strict();

export const rescheduleMilestoneBodySchema = z
  .object({
    plannedAt: isoDateTimeSchema,
    justification: justificationSchema,
    extendPhase: z
      .boolean()
      .optional()
      .describe("Estende o planejamento da fase para cobrir o item, com a mesma justificativa (ajuste em cascata)."),
  })
  .strict();

export const eapScheduleEntityTypeSchema = z.enum(["PROJECT", "PHASE", "TASK", "MILESTONE"]);

export type EapScheduleEntityType = z.infer<typeof eapScheduleEntityTypeSchema>;

export const listScheduleChangesQuerySchema = z
  .object({
    entityType: eapScheduleEntityTypeSchema,
    entityId: z.string().min(1),
  })
  .strict();

export const listProjectReschedulesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).optional().describe("Sem limite, devolve o histórico completo."),
  })
  .strict();

export const eapScheduleImpactCodeSchema = z.enum([
  "PHASE_START_PRECEDED",
  "PHASE_END_EXCEEDED",
  "PROJECT_START_PRECEDED",
  "PROJECT_END_EXCEEDED",
  "ITEMS_OUTSIDE",
  "CRITICAL_MILESTONE",
]);

export const eapScheduleImpactSchema = z.object({
  code: eapScheduleImpactCodeSchema,
  message: z.string(),
});

const planSchema = z.object({
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
});

export const eapScheduleFieldChangeSchema = z.object({
  field: z.enum(["START", "END"]).describe("END é a data prevista nos marcos."),
  kind: z
    .enum(["DEFINED", "RESCHEDULED"])
    .describe("DEFINED: a data não existia (definição inicial); RESCHEDULED: data existente alterada."),
  previous: z.string().nullable(),
  next: z.string().nullable(),
});

export const eapScheduleChangeSchema = z.object({
  id: z.string(),
  entityType: eapScheduleEntityTypeSchema,
  entityId: z.string(),
  kind: z
    .enum(["RESCHEDULE", "PLANNING_DEFINED"])
    .describe("PLANNING_DEFINED é a primeira definição de datas e não conta como reprogramação."),
  sequence: z.number().int().nullable(),
  previous: planSchema,
  next: planSchema,
  changes: z.array(eapScheduleFieldChangeSchema).describe("Classificação de cada data alterada na operação."),
  justification: z.string().nullable(),
  impacts: z.array(eapScheduleImpactSchema),
  escalatedToPmo: z.boolean(),
  wasOverdue: z.boolean(),
  actorId: z.string(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});

export const eapScheduleChangeListResponseSchema = z.object({
  data: z.array(eapScheduleChangeSchema),
});

export const projectReschedulesResponseSchema = z.object({
  total: z.number().int().describe("Reprogramações efetivadas do projeto (a primeira definição de datas não conta)."),
  lastAt: z.string().nullable().describe("Data da reprogramação mais recente."),
  data: z.array(
    eapScheduleChangeSchema.extend({
      entityTitle: z.string().nullable().describe("Nome do item alterado; nulo no projeto ou se o item foi excluído."),
    }),
  ),
});

const monitoredItemSchema = z.object({
  entityType: z.enum(["PHASE", "TASK", "MILESTONE"]),
  entityId: z.string(),
  phaseId: z.string(),
  title: z.string(),
  status: z.string(),
  milestoneType: z.string().nullable(),
  baselineStartAt: z.string().nullable(),
  baselineEndAt: z.string().nullable(),
  plannedStartAt: z.string().nullable(),
  plannedEndAt: z.string().nullable(),
  actualStartAt: z.string().nullable(),
  actualEndAt: z.string().nullable(),
  overdue: z.boolean(),
  deadlinePerformance: z
    .enum(DEADLINE_PERFORMANCES as [DeadlinePerformance, ...DeadlinePerformance[]])
    .nullable()
    .describe("Cumprimento de prazo em relação ao planejamento original e ao vigente."),
  rescheduleCount: z.number().int(),
  responsibleId: z.string().nullable(),
  responsibleName: z.string().nullable(),
});

const homologationItemSchema = z.object({
  milestoneId: z.string(),
  phaseId: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  attempts: z.number().int(),
  rejections: z.number().int(),
  correctionRequests: z.number().int(),
  attemptsUntilHomologation: z.number().int().nullable(),
  reviewerId: z.string().nullable(),
  reviewerName: z.string().nullable(),
  /** Quem entregou e quando a entrega foi enviada para homologação. */
  deliveredById: z.string().nullable(),
  deliveredByName: z.string().nullable(),
  submittedAt: z.string().nullable(),
  /** O usuário atual pode homologar ou rejeitar este marco (permissão e bloqueio de autoaprovação). */
  canDecide: z.boolean(),
});

/** Situação automática do projeto (regras aprovadas): mesma fonte para selos e indicadores. */
export const projectSituationSchema = z
  .object({
    status: z.enum(["SUSPENSO", "CONCLUIDO", "CRITICO", "EM_ATENCAO", "EM_VALIDACAO", "EM_EXECUCAO", "NAO_INICIADO"]),
    delayDays: z.number().int().describe("Maior atraso elegível, em dias corridos."),
    delayedItems: z.number().int(),
    pendingValidation: z.number().int().describe("Marcos entregues aguardando validação."),
    formalDecision: z
      .object({ status: z.enum(["SUSPENSO", "CONCLUIDO"]), decidedAt: z.string() })
      .nullable()
      .describe("Suspensão ou encerramento registrados no histórico do projeto."),
    closureRequirementsMissing: z.boolean().describe("Encerramento registrado sem todas as fases concluídas."),
    readyForClosure: z
      .boolean()
      .describe("Todas as fases concluídas (tarefas concluídas e marcos aceitos), sem encerramento formal; não conclui o projeto."),
    undatedDeliveries: z.number().int().describe("Marcos entregues sem data de entrega conhecida (fora do cálculo de atraso)."),
  })
  .describe("Situação calculada pela EAP; a situação gravada no cadastro é preservada.");

/** Situação do prazo do Planejamento: indicador independente da situação executiva do projeto. */
export const deadlineSituationSchema = z
  .object({
    status: z
      .enum(["CONCLUIDO", "ATRASADO", "EM_ATENCAO", "NO_PRAZO"])
      .nullable()
      .describe("Nula em projeto suspenso."),
    hasDatedCommitments: z
      .boolean()
      .describe("Falso quando não há compromisso datado: No prazo, nesse caso, não indica prazo validado."),
    overdueCommitments: z.number().int().describe("Itens em atraso pela regra única, mais o prazo final do projeto, se vencido."),
    attentionItems: z
      .array(
        z.object({
          entityType: z.enum(["TASK", "MILESTONE"]),
          entityId: z.string(),
          reason: z.enum(["ACTIVE_IMPEDIMENT", "NOT_STARTED_AFTER_PLANNED_START"]),
        }),
      )
      .describe("Compromissos com vencimento na janela de atenção e indicador objetivo de risco."),
    unevaluatedIndicators: z
      .array(z.enum(["DEPENDENCIES", "FORMAL_RISKS"]))
      .describe("Indicadores do critério sem registro no sistema: não foram avaliados."),
  })
  .describe("Situação do prazo calculada sobre as datas vigentes; reprogramações não entram no cálculo.");

export const eapScheduleMonitoringSchema = z.object({
  situation: projectSituationSchema,
  deadlineSituation: deadlineSituationSchema,
  project: z.object({
    baselineStartAt: z.string().nullable(),
    baselineEndAt: z.string().nullable(),
    plannedStartAt: z.string().nullable(),
    plannedEndAt: z.string().nullable(),
    actualStartAt: z
      .string()
      .nullable()
      .describe("Derivada: menor início realizado entre as fases."),
    actualEndAt: z
      .string()
      .nullable()
      .describe("Derivada: maior término realizado, somente com todas as fases concluídas."),
    overdue: z.boolean(),
    rescheduleCount: z.number().int(),
  }),
  reschedules: z.object({
    total: z.number().int(),
    escalated: z.number().int(),
    affectingCriticalMilestones: z.number().int(),
  }),
  overdue: z.object({
    phases: z.number().int(),
    tasks: z.number().int(),
    milestones: z.number().int(),
  }),
  homologation: z.object({
    awaiting: z.number().int(),
    inCorrections: z.number().int(),
    rejected: z.number().int(),
    rejectionDecisions: z.number().int(),
    milestones: z.array(homologationItemSchema),
  }),
  items: z.array(monitoredItemSchema),
});

export const scheduleErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
};
