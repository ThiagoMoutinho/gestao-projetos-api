import { z } from "zod";

import { errorResponseSchema } from "../../../lib/http-error";

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
  })
  .strict();

export const rescheduleMilestoneBodySchema = z
  .object({
    plannedAt: isoDateTimeSchema,
    justification: justificationSchema,
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

export const eapScheduleMonitoringSchema = z.object({
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
