import { z } from "zod";

import { errorResponseSchema } from "../../lib/http-error";

const civilDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data no formato AAAA-MM-DD.")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()) && new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value), "Data inválida.");

const justificationSchema = z.string().trim().min(5, "Informe a justificativa.").max(1000);

export const notificationKindSchema = z.enum(["PREVENTIVE", "OVERDUE", "ESCALATION"]);

export const notificationErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  422: errorResponseSchema,
};

export const settingsSchema = z.object({
  activationEnabled: z.boolean(),
  /** Quinta-feira em que o primeiro ciclo cobrável começa. */
  activationCutoff: z.string().nullable(),
  activatedAt: z.string().nullable(),
  canManage: z.boolean(),
});

export const activateBodySchema = z
  .object({
    cutoff: civilDaySchema,
    justification: justificationSchema,
    confirm: z.literal("ATIVAR"),
  })
  .strict();

export const deactivateBodySchema = z.object({ justification: justificationSchema }).strict();

export const ruleSchema = z.object({
  id: z.string(),
  kind: notificationKindSchema,
  source: z.enum(["ROLE", "USER"]),
  role: z.string().nullable(),
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  visibility: z.enum(["TO", "CC"]),
  enabled: z.boolean(),
});

export const ruleListSchema = z.object({ data: z.array(ruleSchema), canManage: z.boolean() });

/** Regra por perfil (somente PMO ou ADMIN) ou por usuário específico; o perfil global COORDENADOR não é aceito. */
export const createRuleBodySchema = z
  .object({
    kind: notificationKindSchema,
    source: z.enum(["ROLE", "USER"]),
    role: z.enum(["PMO", "ADMIN"]).optional(),
    userId: z.string().min(1).optional(),
    visibility: z.enum(["TO", "CC"]),
    justification: justificationSchema,
  })
  .strict()
  .refine((value) => (value.source === "ROLE" ? value.role !== undefined && value.userId === undefined : value.userId !== undefined && value.role === undefined), {
    message: "Informe o perfil (origem ROLE) ou o usuário (origem USER), não ambos.",
  });

export const updateRuleBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    visibility: z.enum(["TO", "CC"]).optional(),
    justification: justificationSchema,
  })
  .strict()
  .refine((value) => value.enabled !== undefined || value.visibility !== undefined, { message: "Informe o que alterar." });

export const ruleParamsSchema = z.object({ id: z.string().min(1) });

export const notificationItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  kind: notificationKindSchema,
  cycleStart: z.string(),
  sequenceStart: z.string().nullable(),
  dueDate: z.string(),
  scheduledFor: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolutionReason: z.string().nullable(),
  recipients: z.number().int(),
  unread: z.number().int(),
});

/** `nextCursor`: passe em `cursor` para a próxima página; nulo = fim da lista. */
export const notificationListSchema = z.object({ data: z.array(notificationItemSchema), nextCursor: z.string().nullable() });

export const notificationListQuerySchema = z.object({
  kind: notificationKindSchema.optional(),
  projectId: z.string().min(1).optional(),
  resolved: z.enum(["true", "false"]).optional(),
  /** `true`: com destinatários que ainda não leram; `false`: lidas por todos. */
  unread: z.enum(["true", "false"]).optional(),
  cursor: z.string().min(1).max(400).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const notificationParamsSchema = z.object({ id: z.string().min(1) });

export const notificationDetailSchema = notificationItemSchema.extend({
  resolvedValidationId: z.string().nullable(),
  runId: z.string(),
  deliveries: z.array(
    z.object({
      deliveryId: z.string(),
      userId: z.string(),
      recipientName: z.string(),
      recipientEmail: z.string(),
      recipientRole: z.string(),
      visibility: z.enum(["TO", "CC"]),
      deliveredAt: z.string(),
      readAt: z.string().nullable(),
    }),
  ),
});

export const inboxItemSchema = z.object({
  deliveryId: z.string(),
  visibility: z.enum(["TO", "CC"]),
  deliveredAt: z.string(),
  readAt: z.string().nullable(),
  notification: notificationItemSchema.omit({ recipients: true, unread: true }),
});

/** `unread`: total de não lidas do usuário (exato, independente dos filtros e da página). */
export const inboxSchema = z.object({ data: z.array(inboxItemSchema), unread: z.number().int(), nextCursor: z.string().nullable() });

export const inboxQuerySchema = z.object({
  /** Compatível com versões anteriores: `unread=true` equivale a `read=false`. */
  unread: z.enum(["true", "false"]).optional(),
  /** `true`: só lidas; `false`: só não lidas; omitido: todas. */
  read: z.enum(["true", "false"]).optional(),
  kind: notificationKindSchema.optional(),
  projectId: z.string().min(1).optional(),
  resolved: z.enum(["true", "false"]).optional(),
  cursor: z.string().min(1).max(400).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const deliveryParamsSchema = z.object({ id: z.string().min(1) });

export const deliveryReadSchema = z.object({ deliveryId: z.string(), readAt: z.string() });

export const issueSchema = z.object({
  id: z.string(),
  kind: z.enum(["CALENDAR_NOT_VALIDATED", "NO_RECIPIENT", "RECIPIENT_INACTIVE", "RULE_MISSING"]),
  year: z.number().int().nullable(),
  details: z.record(z.string(), z.unknown()),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  occurrences: z.number().int(),
  resolvedAt: z.string().nullable(),
  resolution: z.enum(["AUTO", "MANUAL"]).nullable(),
  resolutionNote: z.string().nullable(),
});

export const issueListSchema = z.object({ data: z.array(issueSchema), canManage: z.boolean() });
export const issueListQuerySchema = z.object({ open: z.enum(["true", "false"]).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
export const issueParamsSchema = z.object({ id: z.string().min(1) });
export const resolveIssueBodySchema = z.object({ note: justificationSchema }).strict();

export const runSchema = z.object({
  id: z.string(),
  mode: z.enum(["DRY_RUN", "ACTIVE"]),
  origin: z.enum(["CLI", "API"]),
  status: z.enum(["RUNNING", "COMPLETED", "FAILED", "SKIPPED_LOCKED"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  asOf: z.string(),
  simulatedCutoff: z.string().nullable(),
  createdNotifications: z.number().int(),
  resolvedNotifications: z.number().int(),
  issuesSeen: z.number().int(),
  summary: z.unknown().nullable(),
  error: z.string().nullable(),
});

export const runListSchema = z.object({ data: z.array(runSchema) });

/** Simulação pela API: nunca grava avisos. A geração real é feita por linha de comando. */
export const dryRunBodySchema = z.object({ cutoff: civilDaySchema.optional() }).strict();

export const changeSchema = z.object({
  id: z.string(),
  action: z.string(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  justification: z.string(),
  actorId: z.string(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});
export const changeListSchema = z.object({ data: z.array(changeSchema) });

const ageSchema = z.number().nullable();

/** Saúde do agendador: estado técnico (o agendador) e estado operacional (as notificações) são independentes. */
export const schedulerHealthSchema = z.object({
  technicalState: z.enum(["FUNCIONANDO", "EM_FALHA", "SEM_SINAL", "DESLIGADO", "DESCONHECIDO"]),
  operationalState: z.enum(["ATIVADAS", "DESATIVADAS"]),
  reasons: z.array(z.string()),
  lastStatus: z.string().nullable(),
  lastError: z.string().nullable(),
  consecutiveFailures: z.number().int(),
  lastSuccessSecondsAgo: ageSchema,
  lastFinishedSecondsAgo: ageSchema,
  /** Segundos até o próximo ciclo (negativo = atrasado). */
  nextDueInSeconds: ageSchema,
  claimedBy: z.string().nullable(),
  lastRunId: z.string().nullable(),
  failureIssueOpen: z.boolean(),
  instances: z.array(
    z.object({
      instanceId: z.string(),
      mode: z.enum(["PLUGIN", "WORKER"]),
      hostname: z.string(),
      pid: z.number().int(),
      intervalSeconds: z.number().int(),
      startedSecondsAgo: z.number(),
      lastSeenSecondsAgo: z.number(),
      stoppedSecondsAgo: ageSchema,
      stopReason: z.string().nullable(),
      alive: z.boolean(),
    }),
  ),
});

export type ActivateInput = z.infer<typeof activateBodySchema>;
export type DeactivateInput = z.infer<typeof deactivateBodySchema>;
export type CreateRuleInput = z.infer<typeof createRuleBodySchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleBodySchema>;
