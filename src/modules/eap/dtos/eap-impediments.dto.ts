import type { eapImpediments } from "../../../db/schema";
import type { EapTaskDto } from "./eap-tasks.dto";

export type EapImpedimentRow = typeof eapImpediments.$inferSelect;

export type EapImpedimentEntryRow = EapImpedimentRow & {
  openedByName: string | null;
  resolvedByName: string | null;
};

export type RegisterImpedimentInput = {
  description: string;
};

export type UpdateImpedimentInput = {
  description: string;
};

export type ResolveImpedimentInput = {
  resolutionNote: string;
};

export type EapImpedimentDto = {
  id: string;
  taskId: string;
  description: string;
  openedBy: string;
  openedAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
};

export type EapImpedimentEntryDto = EapImpedimentDto & {
  openedByName: string | null;
  resolvedByName: string | null;
};

export type EapImpedimentChangeDto = {
  task: EapTaskDto;
  impediment: EapImpedimentDto | null;
};

export function toEapImpedimentDto(row: EapImpedimentRow): EapImpedimentDto {
  return {
    id: row.id,
    taskId: row.taskId,
    description: row.description,
    openedBy: row.openedBy,
    openedAt: row.openedAt.toISOString(),
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionNote: row.resolutionNote,
  };
}

export function toEapImpedimentEntryDto(row: EapImpedimentEntryRow): EapImpedimentEntryDto {
  return {
    ...toEapImpedimentDto(row),
    openedByName: row.openedByName,
    resolvedByName: row.resolvedByName,
  };
}
