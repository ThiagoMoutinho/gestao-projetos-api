import type { eapEvidences } from "../../../db/schema";

export type EapEvidenceRow = typeof eapEvidences.$inferSelect;

export const EVIDENCE_KINDS = ["DOCUMENT", "MINUTES", "REPORT", "GLPI_TICKET", "OTHER"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export type CreateEvidenceInput = {
  /** Opcional apenas para Chamado GLPI (sem título, usa "GLPI #número"). */
  title?: string;
  url: string;
  kind?: EvidenceKind;
  ticketNumber?: string;
  phaseId?: string;
  taskId?: string;
  milestoneId?: string;
  scheduleRequestId?: string;
  projectLevel?: true;
};

export type UpdateEvidenceInput = {
  title?: string;
  url?: string;
  kind?: EvidenceKind;
  ticketNumber?: string;
};

export type ListEvidencesQuery = {
  phaseId?: string;
  taskId?: string;
  milestoneId?: string;
  scheduleRequestId?: string;
};

export type EapEvidenceDto = {
  id: string;
  phaseId: string | null;
  taskId: string | null;
  milestoneId: string | null;
  scheduleRequestId: string | null;
  projectId: string | null;
  projectResultId: string | null;
  title: string;
  url: string;
  kind: EvidenceKind | null;
  ticketNumber: string | null;
  deliveryId: string | null;
  createdBy: string;
  createdAt: string;
};

export function toEapEvidenceDto(row: EapEvidenceRow): EapEvidenceDto {
  return {
    id: row.id,
    phaseId: row.phaseId,
    taskId: row.taskId,
    milestoneId: row.milestoneId,
    scheduleRequestId: row.scheduleRequestId,
    projectId: row.projectId,
    projectResultId: row.projectResultId,
    title: row.title,
    url: row.url,
    kind: row.kind as EvidenceKind | null,
    ticketNumber: row.ticketNumber,
    deliveryId: row.deliveryId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}
