import type { eapTasks } from "../../../db/schema";
import { calculatedTaskStatus } from "../use-cases/eap-status";

export type EapTaskRow = typeof eapTasks.$inferSelect;

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  weight?: number;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  correctiveMilestoneId?: string | null;
};

export type UpdateTaskInput = {
  title?: string;
  description?: string | null;
  assigneeId?: string | null;
  weight?: number;
};

export type UpdateTaskProgressInput = {
  progressPercent?: number;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
};

export type TaskStatusDecisionInput = {
  justification: string;
};

export type EapTaskDto = {
  id: string;
  phaseId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  assigneeId: string | null;
  status: EapTaskRow["status"];
  progressPercent: number;
  weight: number;
  baselineStartAt: string | null;
  baselineEndAt: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  hasImpediment: boolean;
  correctiveMilestoneId: string | null;
  calculatedStatus: EapTaskRow["status"];
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toEapTaskDto(row: EapTaskRow): EapTaskDto {
  return {
    id: row.id,
    phaseId: row.phaseId,
    title: row.title,
    description: row.description,
    sortOrder: row.sortOrder,
    assigneeId: row.assigneeId,
    status: row.status,
    progressPercent: row.progressPercent,
    weight: row.weight,
    baselineStartAt: toIso(row.baselineStartAt),
    baselineEndAt: toIso(row.baselineEndAt),
    plannedStartAt: toIso(row.plannedStartAt),
    plannedEndAt: toIso(row.plannedEndAt),
    actualStartAt: toIso(row.actualStartAt),
    actualEndAt: toIso(row.actualEndAt),
    hasImpediment: row.hasImpediment,
    correctiveMilestoneId: row.correctiveMilestoneId,
    calculatedStatus: calculatedTaskStatus(row),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
