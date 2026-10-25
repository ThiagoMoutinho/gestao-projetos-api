import type { eapMilestones } from "../../../db/schema";
import type {
  EapMilestoneDecision,
  EapMilestoneType,
} from "../schemas/eap-milestones.schema";

export type EapMilestoneRow = typeof eapMilestones.$inferSelect;

export type CreateMilestoneInput = {
  title: string;
  description?: string | null;
  type: EapMilestoneType;
  plannedAt?: string | null;
  reviewerId?: string | null;
};

export type UpdateMilestoneInput = {
  title?: string;
  description?: string | null;
  reviewerId?: string | null;
};

export type ReviewMilestoneInput = {
  decision: EapMilestoneDecision;
  note?: string | null;
  nonconformities?: string | null;
  adjustments?: string | null;
  evidences?: Array<{ title: string; url: string }>;
};

export type EapMilestoneDto = {
  id: string;
  phaseId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  type: EapMilestoneRow["type"];
  status: EapMilestoneRow["status"];
  baselineAt: string | null;
  plannedAt: string | null;
  actualAt: string | null;
  deliveredBy: string | null;
  validatedBy: string | null;
  validationNote: string | null;
  validatedAt: string | null;
  reviewerId: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toEapMilestoneDto(row: EapMilestoneRow): EapMilestoneDto {
  return {
    id: row.id,
    phaseId: row.phaseId,
    title: row.title,
    description: row.description,
    sortOrder: row.sortOrder,
    type: row.type,
    status: row.status,
    baselineAt: toIso(row.baselineAt),
    plannedAt: toIso(row.plannedAt),
    actualAt: toIso(row.actualAt),
    deliveredBy: row.deliveredBy,
    validatedBy: row.validatedBy,
    validationNote: row.validationNote,
    validatedAt: toIso(row.validatedAt),
    reviewerId: row.reviewerId,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
