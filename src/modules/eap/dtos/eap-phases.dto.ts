import type { eapAuditLogs, eapPhases } from "../../../db/schema";
import type { EapPhaseStatus } from "../schemas/eap-phases.schema";

export type EapPhaseRow = typeof eapPhases.$inferSelect;
export type EapAuditLogRow = typeof eapAuditLogs.$inferSelect;

export type CreatePhaseInput = {
  name: string;
  description?: string | null;
  status?: EapPhaseStatus;
  sortOrder?: number;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
};

export type UpdatePhaseInput = {
  name?: string;
  description?: string | null;
  status?: EapPhaseStatus;
};

export type ReorderPhaseItem = {
  phaseId: string;
  sortOrder: number;
};

export type EapPhaseDto = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  status: EapPhaseRow["status"];
  baselineStartAt: string | null;
  baselineEndAt: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toEapPhaseDto(row: EapPhaseRow): EapPhaseDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    status: row.status,
    baselineStartAt: toIso(row.baselineStartAt),
    baselineEndAt: toIso(row.baselineEndAt),
    plannedStartAt: toIso(row.plannedStartAt),
    plannedEndAt: toIso(row.plannedEndAt),
    actualStartAt: toIso(row.actualStartAt),
    actualEndAt: toIso(row.actualEndAt),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
