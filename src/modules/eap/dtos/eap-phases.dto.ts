import type { eapAuditLogs, eapPhases } from "../../../db/schema";
import type { PhaseDates, PhaseProgress, ProjectProgress } from "../use-cases/eap-status";

export type EapProjectProgressDto = ProjectProgress;

export type EapPhaseRow = typeof eapPhases.$inferSelect;
export type EapAuditLogRow = typeof eapAuditLogs.$inferSelect;

export type CreatePhaseInput = {
  name: string;
  description?: string | null;
  sortOrder?: number;
  responsibleId?: string | null;
  completionCriteria?: string | null;
};

export type UpdatePhaseInput = {
  name?: string;
  description?: string | null;
  suspended?: boolean;
  /** Obrigatória ao suspender a fase. */
  justification?: string | null;
  responsibleId?: string | null;
  completionCriteria?: string | null;
  /** Correção explícita das datas reais registradas; exige justificativa. */
  actualStartAt?: string | null;
  actualEndAt?: string | null;
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
  /** Datas indicadas pelos itens (menor início das tarefas; maior término entre tarefas e marcos). */
  consolidatedStartAt: string | null;
  consolidatedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  /** Datas reais indicadas pelos itens; o término só existe com a fase concluída. */
  consolidatedActualStartAt: string | null;
  consolidatedActualEndAt: string | null;
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
  /** Datas calculadas pelas tarefas e marcos; a linha de base vem do registro e nunca é recalculada. */
  dates: PhaseDates;
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
    // Planejamento: o gravado na fase (muda só por reprogramação). Consolidado: o que os itens indicam.
    plannedStartAt: toIso(row.plannedStartAt),
    plannedEndAt: toIso(row.plannedEndAt),
    consolidatedStartAt: toIso(rollup.dates.plannedStartAt),
    consolidatedEndAt: toIso(rollup.dates.plannedEndAt),
    // Datas reais: as registradas na fase. As consolidadas servem só para sinalizar divergência.
    actualStartAt: toIso(row.actualStartAt),
    actualEndAt: toIso(row.actualEndAt),
    consolidatedActualStartAt: toIso(rollup.dates.actualStartAt),
    consolidatedActualEndAt: toIso(rollup.dates.actualEndAt),
    calculatedStatus: rollup.calculatedStatus,
    progressState: rollup.progress.state,
    progressBasisPoints: rollup.progress.basisPoints,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
