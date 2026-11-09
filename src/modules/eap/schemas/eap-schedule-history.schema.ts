import { z } from "zod";

import { eapScheduleEntityTypeSchema, eapScheduleFieldChangeSchema, eapScheduleImpactSchema } from "./eap-schedule.schema";

/**
 * Histórico unificado de cronograma do projeto: reprogramações já efetivadas (registros da auditoria, inclusive as feitas
 * diretamente no modelo anterior), solicitações de reprogramação (em qualquer situação) e definições iniciais de datas.
 * Somente leitura. Nada aqui é inventado: o que não foi registrado vem nulo.
 */
export const scheduleHistorySourceSchema = z
  .enum(["LEGACY_DIRECT", "REQUEST", "INITIAL_DEFINITION"])
  .describe(
    "LEGACY_DIRECT: reprogramação efetivada diretamente (modelo anterior, sem solicitante nem aprovador). REQUEST: solicitação de reprogramação. INITIAL_DEFINITION: primeira definição de datas (não conta como reprogramação).",
  );

export const scheduleHistoryStatusSchema = z.enum([
  "EFETIVADA_DIRETAMENTE",
  "DEFINIDA",
  "PENDENTE",
  "APROVADA",
  "REJEITADA",
  "CANCELADA",
  "CANCELADA_CONFLITO",
]);

const personSchema = z.object({ id: z.string(), name: z.string().nullable() });
const planSchema = z.object({ startAt: z.string().nullable(), endAt: z.string().nullable() });

export const scheduleHistoryItemSchema = z.object({
  id: z.string(),
  source: scheduleHistorySourceSchema,
  status: scheduleHistoryStatusSchema,
  entityType: eapScheduleEntityTypeSchema,
  entityId: z.string(),
  entityTitle: z.string().nullable().describe("Nome do item; nulo no projeto ou se o item foi excluído."),
  field: z.enum(["START", "END"]).nullable().describe("Campo da solicitação (uma por campo); nulo nos registros da auditoria."),
  previous: planSchema,
  next: planSchema.describe("Datas efetivadas ou, em solicitação não aprovada, as datas propostas (nunca vigentes)."),
  changes: z.array(eapScheduleFieldChangeSchema),
  sequence: z.number().int().nullable(),
  justification: z.string().nullable(),
  reasonCategory: z.string().nullable().describe("Categoria do motivo; ainda não registrada (sempre nula nesta etapa)."),
  requestedBy: personSchema.nullable().describe("Solicitante; nulo no modelo anterior, que não registrava solicitação."),
  requestedAt: z.string().nullable(),
  reviewedBy: personSchema.nullable().describe("Analista; nulo no modelo anterior e enquanto a solicitação está pendente."),
  reviewedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  registeredBy: personSchema.nullable().describe("Autor do registro na auditoria (modelo anterior e definição inicial)."),
  occurredAt: z.string().describe("Data de ordenação: registro na auditoria ou solicitação."),
  escalatedToPmo: z.boolean(),
  wasOverdue: z.boolean(),
  impacts: z.array(eapScheduleImpactSchema),
});

export const listScheduleHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    source: scheduleHistorySourceSchema.optional(),
    includeInitial: z.enum(["true", "false"]).default("true").describe("false oculta as definições iniciais de datas."),
  })
  .strict();

export const scheduleHistoryResponseSchema = z.object({
  total: z.number().int().describe("Itens que atendem aos filtros (antes da paginação)."),
  counts: z.object({
    legacyDirect: z.number().int(),
    initialDefinitions: z.number().int(),
    requests: z.object({
      pendente: z.number().int(),
      aprovada: z.number().int(),
      rejeitada: z.number().int(),
      cancelada: z.number().int(),
      canceladaConflito: z.number().int(),
    }),
  }),
  lastRescheduleAt: z.string().nullable().describe("Última reprogramação efetivada (mesmo critério do monitoramento)."),
  data: z.array(scheduleHistoryItemSchema),
});

export type ScheduleHistoryItem = z.infer<typeof scheduleHistoryItemSchema>;
export type ListScheduleHistoryQuery = z.infer<typeof listScheduleHistoryQuerySchema>;
export type ScheduleHistoryResponse = z.infer<typeof scheduleHistoryResponseSchema>;
