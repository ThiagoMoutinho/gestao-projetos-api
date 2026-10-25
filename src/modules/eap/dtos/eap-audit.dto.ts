import type { EapAuditEntryRow } from "../repositories/contracts";
import type { EapAuditEntityType, EapAuditEventKind } from "../schemas/eap-audit.schema";

export type ListAuditQuery = {
  entityType: EapAuditEntityType;
  entityId: string;
  limit?: number;
};

export type EapAuditDetailsDto = {
  kind: EapAuditEventKind;
  automatic: boolean;
  fromStatus: string | null;
  toStatus: string | null;
  justification: string | null;
  note: string | null;
  nonconformities: string | null;
  adjustments: string | null;
  round: number | null;
  cause: string | null;
  fromPercent: number | null;
  toPercent: number | null;
  reason: string | null;
  previousReason: string | null;
  resolutionNote: string | null;
  openMinutes: number | null;
};

export type EapAuditEntryDto = {
  id: string;
  entityType: string;
  entityId: string;
  action: EapAuditEntryRow["action"];
  summary: string;
  actorId: string;
  actorName: string | null;
  createdAt: string;
  details: EapAuditDetailsDto;
};

function text(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numeric(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function eventKind(row: EapAuditEntryRow, payload: Record<string, unknown>): EapAuditEventKind {
  if (row.entityType === "EVIDENCE") return "EVIDENCE";
  const from = text(payload, "from");
  const to = text(payload, "to");

  switch (row.action) {
    case "IMPEDE":
      return "IMPEDIMENT_OPENED";
    case "CLEAR_IMPEDIMENT":
      return "IMPEDIMENT_RESOLVED";
    case "CREATE":
      return "CREATION";
    case "DELETE":
      return "DELETION";
    case "SCHEDULE_CHANGE":
      if (payload.kind === "RESCHEDULE") return "RESCHEDULE";
      if (payload.kind === "PLANNING_DEFINED") return "PLANNING_DEFINED";
      return "OTHER";
    case "VALIDATE":
      if (to === "APROVADO") return "ACCEPTANCE";
      if (to === "AJUSTES_SOLICITADOS") return "ADJUSTMENTS_REQUESTED";
      if (to === "REJEITADO") return "REJECTION";
      return "OTHER";
    case "STATUS_CHANGE":
      if (payload.kind === "DELIVER") return "DELIVERY";
      if (payload.automatic === true) return "AUTOMATIC_STATUS";
      if (row.entityType === "TASK" && to === "CANCELADA") return "CANCELLATION";
      if (row.entityType === "TASK" && from === "CANCELADA") return "REACTIVATION";
      return "STATUS";
    case "UPDATE":
      if (payload.kind === "IMPEDIMENT_UPDATE") return "IMPEDIMENT_UPDATED";
      if (payload.kind === "AUTHORIZE_RESUBMISSION") return "RESUBMISSION_AUTHORIZED";
      if (
        payload.kind === "PROGRESS" &&
        typeof payload.hasImpediment === "boolean" &&
        numeric(payload, "progressPercent") === null
      ) {
        return payload.hasImpediment ? "IMPEDIMENT_FLAGGED" : "IMPEDIMENT_UNFLAGGED";
      }
      if (payload.kind === "PROGRESS") return "PROGRESS";
      if (Array.isArray(payload.items)) return "REORDER";
      return "UPDATE";
    default:
      return "OTHER";
  }
}

/** Expõe apenas campos reconhecidos do payload; o restante da auditoria não sai da API. */
export function toEapAuditDetails(row: EapAuditEntryRow): EapAuditDetailsDto {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};
  const kind = eventKind(row, payload);
  const progress = kind === "PROGRESS";
  const impediment =
    kind === "IMPEDIMENT_OPENED" || kind === "IMPEDIMENT_UPDATED" || kind === "IMPEDIMENT_RESOLVED";

  return {
    kind,
    automatic: payload.automatic === true,
    fromStatus: text(payload, "from"),
    toStatus: text(payload, "to"),
    justification: text(payload, "justification"),
    note: text(payload, "note"),
    nonconformities: text(payload, "nonconformities"),
    adjustments: text(payload, "adjustments"),
    round: numeric(payload, "round"),
    cause: text(payload, "cause"),
    fromPercent: progress ? numeric(payload, "previousProgressPercent") : null,
    toPercent: progress ? numeric(payload, "progressPercent") : null,
    reason: impediment ? text(payload, "description") : null,
    previousReason: impediment ? text(payload, "previousDescription") : null,
    resolutionNote: impediment ? text(payload, "resolutionNote") : null,
    openMinutes: impediment ? numeric(payload, "openMinutes") : null,
  };
}

export function toEapAuditEntryDto(row: EapAuditEntryRow): EapAuditEntryDto {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    summary: row.summary,
    actorId: row.actorId,
    actorName: row.actorName,
    createdAt: row.createdAt.toISOString(),
    details: toEapAuditDetails(row),
  };
}
