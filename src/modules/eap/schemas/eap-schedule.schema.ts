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

export const eapScheduleMonitoringSchema = z.object({
  situation: projectSituationSchema,
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
