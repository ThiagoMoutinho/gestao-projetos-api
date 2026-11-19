import { z } from "zod";

import { errorResponseSchema } from "../../lib/http-error";
import { FUNCTION_NAME_MAX, FUNCTION_NAME_MIN } from "./member-functions.text";

export const memberFunctionSchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
});

export const memberFunctionListResponseSchema = z.object({ data: z.array(memberFunctionSchema) });

export const listMemberFunctionsQuerySchema = z
  .object({
    /** Só ADMIN e PMO enxergam as desativadas; para os demais o parâmetro é ignorado. */
    includeInactive: z.enum(["true", "false"]).optional(),
  })
  .strict();

export const createMemberFunctionBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(FUNCTION_NAME_MIN, `Use pelo menos ${FUNCTION_NAME_MIN} caracteres.`)
      .max(FUNCTION_NAME_MAX, `Use no máximo ${FUNCTION_NAME_MAX} caracteres.`),
  })
  .strict();

export const memberFunctionParamsSchema = z.object({ id: z.string().min(1) });

export const updateMemberFunctionBodySchema = z.object({ isActive: z.boolean() }).strict();

export const memberFunctionErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
};

export type MemberFunctionDto = z.infer<typeof memberFunctionSchema>;
