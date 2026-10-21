import type { eapEvidences } from "../../../db/schema";

export type EapEvidenceRow = typeof eapEvidences.$inferSelect;

export type CreateEvidenceInput = {
  title: string;
  url: string;
  taskId?: string;
  milestoneId?: string;
  scheduleRequestId?: string;
};

export type UpdateEvidenceInput = {
  title?: string;
  url?: string;
};

export type ListEvidencesQuery = {
  taskId?: string;
  milestoneId?: string;
  scheduleRequestId?: string;
};

export type EapEvidenceDto = {
  id: string;
  taskId: string | null;
  milestoneId: string | null;
  scheduleRequestId: string | null;
  title: string;
  url: string;
  createdBy: string;
  createdAt: string;
};

export function toEapEvidenceDto(row: EapEvidenceRow): EapEvidenceDto {
  return {
    id: row.id,
    taskId: row.taskId,
    milestoneId: row.milestoneId,
    scheduleRequestId: row.scheduleRequestId,
    title: row.title,
    url: row.url,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}
