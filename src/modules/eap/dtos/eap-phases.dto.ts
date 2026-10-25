import type { eapAuditLogs, eapPhases } from "../../../db/schema";
import type { PhaseProgress, ProjectProgress } from "../use-cases/eap-status";

export type EapProjectProgressDto = ProjectProgress;

export type EapPhaseRow = typeof eapPhases.$inferSelect;
export type EapAuditLogRow = typeof eapAuditLogs.$inferSelect;

export type CreatePhaseInput = {
  name: string;
  description?: string | null;
  sortOrder?: number;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  responsibleId?: string | null;
  completionCriteria?: string | null;
};

export type UpdatePhaseInput = {
  name?: string;
  description?: string | null;
  suspended?: boolean;
  responsibleId?: string | null;
  completionCriteria?: string | null;
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
  responsibleId: string | null;
  completionCriteria: string | null;
  baselineStartAt: string | null;
  baselineEndAt: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  calculatedStatus: EapPhaseRow["status"];
  progressState: PhaseProgress["state"];
  progressBasisPoints: number | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type PhaseRollup = {
  calculatedStatus: EapPhaseRow["status"];
  progress: PhaseProgress;
};

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toEapPhaseDto(row: EapPhaseRow, rollup: PhaseRollup): EapPhaseDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    status: row.status,
    responsibleId: row.responsibleId,
    completionCriteria: row.completionCriteria,
    baselineStartAt: toIso(row.baselineStartAt),
    baselineEndAt: toIso(row.baselineEndAt),
    plannedStartAt: toIso(row.plannedStartAt),
    plannedEndAt: toIso(row.plannedEndAt),
    actualStartAt: toIso(row.actualStartAt),
    actualEndAt: toIso(row.actualEndAt),
    calculatedStatus: rollup.calculatedStatus,
    progressState: rollup.progress.state,
    progressBasisPoints: rollup.progress.basisPoints,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
