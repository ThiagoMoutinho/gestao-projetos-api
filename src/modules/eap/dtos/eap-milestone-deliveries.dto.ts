import type { eapMilestoneDeliveries } from "../../../db/schema";

export type EapMilestoneDeliveryRow = typeof eapMilestoneDeliveries.$inferSelect;

export type EapMilestoneDeliveryEntryRow = EapMilestoneDeliveryRow & {
  submittedByName: string | null;
  decidedByName: string | null;
  resubmissionAuthorizedByName: string | null;
};

export type DeliverMilestoneInput = {
  note?: string | null;
};

export type AuthorizeResubmissionInput = {
  justification: string;
};

export type EapMilestoneDeliveryDto = {
  id: string;
  milestoneId: string;
  round: number;
  legacy: boolean;
  status: EapMilestoneDeliveryRow["status"];
  submittedBy: string;
  submittedByName: string | null;
  submittedAt: string | null;
  note: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  nonconformities: string | null;
  adjustments: string | null;
  resubmissionAuthorizedBy: string | null;
  resubmissionAuthorizedByName: string | null;
  resubmissionAuthorizedAt: string | null;
  resubmissionNote: string | null;
};

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toEapMilestoneDeliveryDto(row: EapMilestoneDeliveryEntryRow): EapMilestoneDeliveryDto {
  return {
    id: row.id,
    milestoneId: row.milestoneId,
    round: row.round,
    legacy: row.legacy,
    status: row.status,
    submittedBy: row.submittedBy,
    submittedByName: row.submittedByName,
    submittedAt: toIso(row.submittedAt),
    note: row.note,
    decidedBy: row.decidedBy,
    decidedByName: row.decidedByName,
    decidedAt: toIso(row.decidedAt),
    decisionNote: row.decisionNote,
    nonconformities: row.nonconformities,
    adjustments: row.adjustments,
    resubmissionAuthorizedBy: row.resubmissionAuthorizedBy,
    resubmissionAuthorizedByName: row.resubmissionAuthorizedByName,
    resubmissionAuthorizedAt: toIso(row.resubmissionAuthorizedAt),
    resubmissionNote: row.resubmissionNote,
  };
}
