import { z } from "zod";

import { eapTaskSchema, taskParamsSchema } from "./eap-tasks.schema";

export const impedimentParamsSchema = taskParamsSchema.extend({
  impedimentId: z.string().min(1),
});

const impedimentText = z.string().trim().min(10).max(2000);

export const registerImpedimentBodySchema = z
  .object({
    description: impedimentText.describe("Motivo do impedimento e ação necessária."),
  })
  .strict();

export const updateImpedimentBodySchema = registerImpedimentBodySchema;

export const resolveImpedimentBodySchema = z
  .object({
    resolutionNote: impedimentText.describe("Como o impedimento foi resolvido."),
  })
  .strict();

export const eapImpedimentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  description: z.string(),
  openedBy: z.string(),
  openedAt: z.string(),
  resolvedBy: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolutionNote: z.string().nullable(),
});

export const eapImpedimentListResponseSchema = z.object({
  data: z.array(
    eapImpedimentSchema.extend({
      openedByName: z.string().nullable(),
      resolvedByName: z.string().nullable(),
    }),
  ),
});

export const eapImpedimentChangeResponseSchema = z.object({
  task: eapTaskSchema,
  impediment: eapImpedimentSchema.nullable(),
});
