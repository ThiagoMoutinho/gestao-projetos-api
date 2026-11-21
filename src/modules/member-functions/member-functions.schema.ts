import { z } from "zod";

import { errorResponseSchema } from "../../lib/http-error";
import { FUNCTION_NAME_MAX, FUNCTION_NAME_MIN } from "./member-functions.text";

/** Uso da função: participantes que a têm hoje e registros do histórico (auditoria) que a mencionam. Só ADMIN e PMO enxergam. */
export const memberFunctionUsageSchema = z.object({
  members: z.number().int(),
  history: z.number().int(),
});

export const memberFunctionSchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  /** Nulo para quem não gerencia o catálogo. */
  usage: memberFunctionUsageSchema.nullable(),
});

export const memberFunctionListResponseSchema = z.object({ data: z.array(memberFunctionSchema) });

export const listMemberFunctionsQuerySchema = z
  .object({
    /** Só ADMIN e PMO enxergam as desativadas; para os demais o parâmetro é ignorado. */
    includeInactive: z.enum(["true", "false"]).optional(),
  })
  .strict();

const nameSchema = z
  .string()
  .trim()
  .min(FUNCTION_NAME_MIN, `Use pelo menos ${FUNCTION_NAME_MIN} caracteres.`)
  .max(FUNCTION_NAME_MAX, `Use no máximo ${FUNCTION_NAME_MAX} caracteres.`);

export const createMemberFunctionBodySchema = z.object({ name: nameSchema }).strict();

export const memberFunctionParamsSchema = z.object({ id: z.string().min(1) });

/** Editar o nome e/ou ativar/desativar. Pelo menos um dos campos. */
export const updateMemberFunctionBodySchema = z
  .object({ name: nameSchema.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((body) => body.name !== undefined || body.isActive !== undefined, { message: "Informe o nome e/ou a situação." });

export const memberFunctionErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
};

export type MemberFunctionDto = z.infer<typeof memberFunctionSchema>;
export type MemberFunctionUsage = z.infer<typeof memberFunctionUsageSchema>;
