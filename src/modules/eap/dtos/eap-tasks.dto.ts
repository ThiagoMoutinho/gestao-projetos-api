import type { eapTasks } from "../../../db/schema";
import { calculatedTaskStatus } from "../use-cases/eap-status";

export type EapTaskRow = typeof eapTasks.$inferSelect;

export type CreateTaskInput = {
  /** Cria a tarefa como subtarefa desta (que deve ser da mesma fase e não pode ser subtarefa). */
  parentTaskId?: string | null;
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  secondaryAssigneeId?: string | null;
  weight?: number;
  priority?: EapTaskRow["priority"];
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  correctiveMilestoneId?: string | null;
  /** Ajuste em cascata: estende a fase para cobrir as datas da tarefa. */
  extendPhase?: boolean;
  justification?: string | null;
};

export type UpdateTaskInput = {
  title?: string;
  description?: string | null;
  assigneeId?: string | null;
  secondaryAssigneeId?: string | null;
  weight?: number;
  priority?: EapTaskRow["priority"];
};

export type UpdateTaskProgressInput = {
  progressPercent?: number;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  justification?: string | null;
};

export type TaskStatusDecisionInput = {
  justification: string;
};

export type EapTaskDto = {
  id: string;
  phaseId: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  sortOrder: number;
  assigneeId: string | null;
  secondaryAssigneeId: string | null;
  status: EapTaskRow["status"];
  progressPercent: number;
  weight: number;
  priority: EapTaskRow["priority"];
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
    parentTaskId: row.parentTaskId,
    title: row.title,
    description: row.description,
    sortOrder: row.sortOrder,
    assigneeId: row.assigneeId,
    secondaryAssigneeId: row.secondaryAssigneeId,
    status: row.status,
    progressPercent: row.progressPercent,
    weight: row.weight,
    priority: row.priority,
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
