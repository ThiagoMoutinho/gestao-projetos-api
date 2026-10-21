import type { EapAuditEntryRow } from "../repositories/contracts";
import type { EapAuditEntityType } from "../schemas/eap-audit.schema";

export type ListAuditQuery = {
  entityType: EapAuditEntityType;
  entityId: string;
  limit?: number;
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
};

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
  };
}
