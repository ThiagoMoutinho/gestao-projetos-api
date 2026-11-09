import type { EapScheduleChangeDto } from "../dtos/eap-schedule.dto";
import type { ScheduleRequestChangeRow, ScheduleRequestHistoryRow } from "../repositories/contracts";
import type { ListScheduleHistoryQuery, ScheduleHistoryItem, ScheduleHistoryResponse } from "../schemas/eap-schedule-history.schema";

export type AuditScheduleEntry = { dto: EapScheduleChangeDto; requestId: string | null };

type Person = { id: string; name: string | null };

export type ScheduleHistoryInput = {
  audit: AuditScheduleEntry[];
  requests: ScheduleRequestHistoryRow[];
  changes: ScheduleRequestChangeRow[];
  titleOf: (entityType: "PROJECT" | "PHASE" | "TASK" | "MILESTONE", entityId: string) => string | null;
  personOf: (id: string | null) => Person | null;
};

const iso = (value: Date | null) => value?.toISOString() ?? null;

function requestTarget(row: ScheduleRequestHistoryRow) {
  if (row.phaseId) return { entityType: "PHASE" as const, entityId: row.phaseId };
  if (row.taskId) return { entityType: "TASK" as const, entityId: row.taskId };
  return { entityType: "MILESTONE" as const, entityId: row.milestoneId as string };
}

/** Plano com a data em início ou término; marco usa o término (data prevista). */
function planOf(field: "START" | "END", value: string | null) {
  return field === "START" ? { startAt: value, endAt: null } : { startAt: null, endAt: value };
}

/**
 * Une, sem inventar nada, as três fontes do histórico de cronograma:
 * - auditoria `SCHEDULE_CHANGE`: reprogramação sem `requestId` = LEGACY_DIRECT (efetivada diretamente, modelo anterior; sem
 *   solicitante, aprovador ou categoria); definição inicial = INITIAL_DEFINITION;
 * - solicitações: situação real (PENDENTE, APROVADA, REJEITADA, CANCELADA, CANCELADA_CONFLITO). Pendente, rejeitada e cancelada
 *   mostram só as datas PROPOSTAS: nenhuma delas altera o vigente.
 * Registro de auditoria que referencia uma solicitação não vira item à parte (evita contar duas vezes); seus detalhes
 * (sequência, impactos) complementam o item da solicitação.
 */
export function buildScheduleHistory(input: ScheduleHistoryInput, query: ListScheduleHistoryQuery): ScheduleHistoryResponse {
  const requestIds = new Set(input.requests.map((row) => row.id));
  const auditByRequest = new Map(
    input.audit.filter((entry) => entry.requestId && requestIds.has(entry.requestId)).map((entry) => [entry.requestId as string, entry.dto]),
  );
  const changeByRequest = new Map(input.changes.map((change) => [change.requestId, change]));

  const items: ScheduleHistoryItem[] = [];

  for (const { dto, requestId } of input.audit) {
    if (requestId && requestIds.has(requestId)) continue;
    const initial = dto.kind === "PLANNING_DEFINED";
    items.push({
      id: `audit:${dto.id}`,
      source: initial ? "INITIAL_DEFINITION" : "LEGACY_DIRECT",
      status: initial ? "DEFINIDA" : "EFETIVADA_DIRETAMENTE",
      entityType: dto.entityType,
      entityId: dto.entityId,
      entityTitle: dto.entityType === "PROJECT" ? null : input.titleOf(dto.entityType, dto.entityId),
      field: null,
      previous: dto.previous,
      next: dto.next,
      changes: dto.changes,
      sequence: dto.sequence,
      justification: dto.justification,
      reasonCategory: null,
      requestedBy: null,
      requestedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      decisionNote: null,
      registeredBy: input.personOf(dto.actorId) ?? { id: dto.actorId, name: dto.actorName },
      occurredAt: dto.createdAt,
      escalatedToPmo: dto.escalatedToPmo,
      wasOverdue: dto.wasOverdue,
      impacts: dto.impacts,
    });
  }

  for (const row of input.requests) {
    const target = requestTarget(row);
    const field = row.field === "PLANNED_START_AT" ? ("START" as const) : ("END" as const);
    const applied = row.status === "APROVADA" ? changeByRequest.get(row.id) : undefined;
    const previousValue = iso(applied ? applied.oldValue : row.expectedCurrentValue);
    const nextValue = iso(applied ? applied.newValue : row.proposedValue);
    const audit = auditByRequest.get(row.id);
    items.push({
      id: `request:${row.id}`,
      source: "REQUEST",
      status: row.status,
      ...target,
      entityTitle: input.titleOf(target.entityType, target.entityId),
      field,
      previous: planOf(field, previousValue),
      next: planOf(field, nextValue),
      changes: [{ field, kind: previousValue === null ? "DEFINED" : "RESCHEDULED", previous: previousValue, next: nextValue }],
      sequence: audit?.sequence ?? null,
      justification: row.justification.trim() ? row.justification : null,
      reasonCategory: null,
      requestedBy: input.personOf(row.requestedBy) ?? { id: row.requestedBy, name: null },
      requestedAt: row.requestedAt.toISOString(),
      reviewedBy: row.reviewedBy ? (input.personOf(row.reviewedBy) ?? { id: row.reviewedBy, name: null }) : null,
      reviewedAt: iso(row.reviewedAt),
      decisionNote: row.decisionNote,
      registeredBy: null,
      occurredAt: row.requestedAt.toISOString(),
      escalatedToPmo: audit?.escalatedToPmo ?? false,
      wasOverdue: audit?.wasOverdue ?? false,
      impacts: audit?.impacts ?? [],
    });
  }

  items.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id));

  const byStatus = (status: ScheduleHistoryItem["status"]) => items.filter((item) => item.source === "REQUEST" && item.status === status).length;
  const counts = {
    legacyDirect: items.filter((item) => item.source === "LEGACY_DIRECT").length,
    initialDefinitions: items.filter((item) => item.source === "INITIAL_DEFINITION").length,
    requests: {
      pendente: byStatus("PENDENTE"),
      aprovada: byStatus("APROVADA"),
      rejeitada: byStatus("REJEITADA"),
      cancelada: byStatus("CANCELADA"),
      canceladaConflito: byStatus("CANCELADA_CONFLITO"),
    },
  };

  // Mesmo critério do monitoramento: só reprogramações efetivadas registradas na auditoria.
  const lastRescheduleAt =
    input.audit
      .filter((entry) => entry.dto.kind === "RESCHEDULE")
      .map((entry) => entry.dto.createdAt)
      .sort()
      .at(-1) ?? null;

  const filtered = items.filter(
    (item) => (!query.source || item.source === query.source) && (query.includeInitial === "true" || item.source !== "INITIAL_DEFINITION"),
  );

  return {
    total: filtered.length,
    counts,
    lastRescheduleAt,
    data: filtered.slice(query.offset, query.offset + query.limit),
  };
}
