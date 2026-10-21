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

export const eapAuditEntrySchema = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  action: z.enum(eapAuditActionEnum.enumValues),
  summary: z.string(),
  actorId: z.string(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
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
