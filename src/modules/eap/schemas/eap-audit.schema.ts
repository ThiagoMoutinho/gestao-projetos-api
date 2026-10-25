import { z } from "zod";

import { eapAuditActionEnum } from "../../../db/schema";
import { errorResponseSchema } from "../../../lib/http-error";

export const eapAuditEntityTypeSchema = z.enum(["PHASE", "TASK", "MILESTONE"]);

export type EapAuditEntityType = z.infer<typeof eapAuditEntityTypeSchema>;

export const listAuditQuerySchema = z
  .object({
    entityType: eapAuditEntityTypeSchema,
    entityId: z.string().min(1),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const eapAuditEventKindSchema = z.enum([
  "CANCELLATION",
  "REACTIVATION",
  "AUTOMATIC_STATUS",
  "STATUS",
  "PROGRESS",
  "IMPEDIMENT_OPENED",
  "IMPEDIMENT_UPDATED",
  "IMPEDIMENT_RESOLVED",
  "IMPEDIMENT_FLAGGED",
  "IMPEDIMENT_UNFLAGGED",
  "DELIVERY",
  "ACCEPTANCE",
  "ADJUSTMENTS_REQUESTED",
  "REJECTION",
  "RESUBMISSION_AUTHORIZED",
  "RESCHEDULE",
  "PLANNING_DEFINED",
  "CREATION",
  "UPDATE",
  "DELETION",
  "REORDER",
  "EVIDENCE",
  "OTHER",
]);

export type EapAuditEventKind = z.infer<typeof eapAuditEventKindSchema>;

export const eapAuditDetailsSchema = z.object({
  kind: eapAuditEventKindSchema,
  automatic: z.boolean(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  justification: z.string().nullable(),
  note: z.string().nullable(),
  nonconformities: z.string().nullable(),
  adjustments: z.string().nullable(),
  round: z.number().nullable(),
  cause: z.string().nullable(),
  fromPercent: z.number().nullable(),
  toPercent: z.number().nullable(),
  reason: z.string().nullable(),
  previousReason: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  openMinutes: z.number().nullable(),
});

export const eapAuditEntrySchema = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  action: z.enum(eapAuditActionEnum.enumValues),
  summary: z.string(),
  actorId: z.string(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
  details: eapAuditDetailsSchema,
});

export const eapAuditListResponseSchema = z.object({
  data: z.array(eapAuditEntrySchema),
});

export const auditErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
};
