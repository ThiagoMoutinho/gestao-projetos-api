import type { z } from "zod";

import type { EapAuditEntryRow } from "../repositories/contracts";
import type {
  EapScheduleEntityType,
  eapScheduleChangeSchema,
  eapScheduleFieldChangeSchema,
  eapScheduleImpactCodeSchema,
  eapScheduleMonitoringSchema,
} from "../schemas/eap-schedule.schema";

export type RescheduleRangeInput = {
  plannedStartAt: string;
  plannedEndAt: string;
  justification?: string | null;
};

export type RescheduleMilestoneInput = {
  plannedAt: string;
  justification?: string | null;
};

export type ListScheduleChangesQuery = {
  entityType: EapScheduleEntityType;
  entityId: string;
};

export type EapScheduleImpactCode = z.infer<typeof eapScheduleImpactCodeSchema>;
export type EapScheduleImpact = { code: EapScheduleImpactCode; message: string };
export type EapScheduleChangeDto = z.infer<typeof eapScheduleChangeSchema>;
export type EapScheduleMonitoringDto = z.infer<typeof eapScheduleMonitoringSchema>;

export type SchedulePlan = { startAt: Date | null; endAt: Date | null };
export type EapScheduleFieldChange = z.infer<typeof eapScheduleFieldChangeSchema>;

export const SCHEDULE_CHANGE_KINDS = ["RESCHEDULE", "PLANNING_DEFINED"] as const;

function isoOrNull(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function planFrom(value: unknown) {
  const plan = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { startAt: isoOrNull(plan.startAt), endAt: isoOrNull(plan.endAt) };
}

/** Data que não existia é definição inicial; data existente alterada é reprogramação. */
export function classifyFieldChange(
  field: EapScheduleFieldChange["field"],
  previous: string | null,
  next: string | null,
): EapScheduleFieldChange {
  return { field, kind: previous === null ? "DEFINED" : "RESCHEDULED", previous, next };
}

function isFieldChange(value: unknown): value is EapScheduleFieldChange {
  const change = value as Record<string, unknown> | null;
  return (
    !!change &&
    (change.field === "START" || change.field === "END") &&
    (change.kind === "DEFINED" || change.kind === "RESCHEDULED")
  );
}

/**
 * Registros gravados antes da classificação por data não têm `changes`; a classificação é
 * reconstruída a partir das datas anterior e nova gravadas no próprio registro.
 */
function changesFrom(payload: Record<string, unknown>, previous: ReturnType<typeof planFrom>, next: ReturnType<typeof planFrom>) {
  if (Array.isArray(payload.changes)) {
    return payload.changes.filter(isFieldChange).map((change) => ({
      field: change.field,
      kind: change.kind,
      previous: isoOrNull(change.previous),
      next: isoOrNull(change.next),
    }));
  }
  const changes: EapScheduleFieldChange[] = [];
  if (previous.startAt !== next.startAt) changes.push(classifyFieldChange("START", previous.startAt, next.startAt));
  if (previous.endAt !== next.endAt) changes.push(classifyFieldChange("END", previous.endAt, next.endAt));
  return changes;
}

export function isScheduleChangeEntry(row: EapAuditEntryRow) {
  const payload = row.payload as Record<string, unknown> | null;
  return (
    row.action === "SCHEDULE_CHANGE" &&
    (SCHEDULE_CHANGE_KINDS as readonly unknown[]).includes(payload?.kind)
  );
}

export function isRescheduleEntry(row: EapAuditEntryRow) {
  return isScheduleChangeEntry(row) && (row.payload as Record<string, unknown>).kind === "RESCHEDULE";
}

export function toEapScheduleChangeDto(row: EapAuditEntryRow): EapScheduleChangeDto {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const impacts = Array.isArray(payload.impacts)
    ? (payload.impacts as EapScheduleImpact[]).filter(
        (impact) => typeof impact?.code === "string" && typeof impact?.message === "string",
      )
    : [];
  const previous = planFrom(payload.previous);
  const next = planFrom(payload.next);

  return {
    id: row.id,
    entityType: row.entityType as EapScheduleEntityType,
    entityId: row.entityId,
    kind: payload.kind === "PLANNING_DEFINED" ? "PLANNING_DEFINED" : "RESCHEDULE",
    sequence: typeof payload.sequence === "number" ? payload.sequence : null,
    previous,
    next,
    changes: changesFrom(payload, previous, next),
    justification:
      typeof payload.justification === "string" && payload.justification.trim()
        ? payload.justification
        : null,
    impacts,
    escalatedToPmo: payload.escalatedToPmo === true,
    wasOverdue: payload.wasOverdue === true,
    actorId: row.actorId,
    actorName: row.actorName,
    createdAt: row.createdAt.toISOString(),
  };
}
