import { z } from "zod";

import { errorResponseSchema } from "../../lib/http-error";

export const CALENDAR_SCOPES = ["NACIONAL", "ESTADUAL_PA", "MUNICIPAL_BELEM", "INSTITUCIONAL"] as const;
export const CALENDAR_KINDS = ["FERIADO", "PONTO_FACULTATIVO", "NAO_UTIL_INSTITUCIONAL", "EXPEDIENTE_EXCECAO"] as const;

const civilDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data no formato AAAA-MM-DD.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Data inválida.");

const yearSchema = z.coerce.number().int().min(2000).max(2200);

export const calendarYearParamsSchema = z.object({ year: yearSchema });
export const calendarDayParamsSchema = z.object({ id: z.string().min(1) });

export const createCalendarDayBodySchema = z
  .object({
    day: civilDaySchema,
    scope: z.enum(CALENDAR_SCOPES),
    kind: z.enum(CALENDAR_KINDS),
    /** Padrão: observado, exceto ponto facultativo (que só vira dia não útil se o IGEPPS decidir). */
    observed: z.boolean().optional(),
    description: z.string().trim().min(3).max(200),
    /** Decreto, lei ou ato institucional. Obrigatório fora do escopo nacional. */
    legalBasis: z.string().trim().min(3).max(500).optional(),
  })
  .strict();

export const updateCalendarDayBodySchema = z
  .object({
    day: civilDaySchema.optional(),
    scope: z.enum(CALENDAR_SCOPES).optional(),
    kind: z.enum(CALENDAR_KINDS).optional(),
    observed: z.boolean().optional(),
    description: z.string().trim().min(3).max(200).optional(),
    legalBasis: z.string().trim().min(3).max(500).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos um campo para atualizar." });

export const validateCalendarYearBodySchema = z
  .object({
    nationalChecked: z.literal(true, { error: "Confirme a conferência dos feriados nacionais." }),
    stateChecked: z.literal(true, { error: "Confirme a conferência dos feriados do Pará." }),
    municipalChecked: z.literal(true, { error: "Confirme a conferência dos feriados de Belém." }),
    sourceNote: z.string().trim().min(10).max(1000),
  })
  .strict();

export const readinessQuerySchema = z.object({ from: civilDaySchema, to: civilDaySchema }).strict();

export const calendarDaySchema = z.object({
  id: z.string(),
  year: z.number().int(),
  day: z.string(),
  scope: z.enum(CALENDAR_SCOPES),
  kind: z.enum(CALENDAR_KINDS),
  observed: z.boolean(),
  description: z.string(),
  legalBasis: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
});

export const calendarYearSchema = z.object({
  year: z.number().int(),
  status: z.enum(["DRAFT", "VALIDATED"]),
  nationalChecked: z.boolean(),
  stateChecked: z.boolean(),
  municipalChecked: z.boolean(),
  sourceNote: z.string().nullable(),
  validatedBy: z.string().nullable(),
  validatedAt: z.string().nullable(),
  /** Só o ADMIN altera o calendário; o PMO consulta. */
  canManage: z.boolean(),
});

export const calendarYearListSchema = z.object({ data: z.array(calendarYearSchema) });
export const calendarYearDetailSchema = calendarYearSchema.extend({ days: z.array(calendarDaySchema) });

export const nationalSuggestionsSchema = z.object({
  data: z.array(z.object({ day: z.string(), description: z.string(), exists: z.boolean() })),
});

export const calendarChangeSchema = z.object({
  id: z.string(),
  year: z.number().int(),
  dayId: z.string().nullable(),
  action: z.enum(["DAY_CREATE", "DAY_UPDATE", "DAY_DELETE", "YEAR_VALIDATE", "YEAR_REVERT_TO_DRAFT"]),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  note: z.string().nullable(),
  actorId: z.string(),
  actorName: z.string().nullable(),
  at: z.string(),
});
export const calendarChangeListSchema = z.object({ data: z.array(calendarChangeSchema) });

export const readinessSchema = z.object({ ready: z.boolean(), missingYears: z.array(z.number().int()) });

export const calendarErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
};

export type CreateCalendarDayInput = z.infer<typeof createCalendarDayBodySchema>;
export type UpdateCalendarDayInput = z.infer<typeof updateCalendarDayBodySchema>;
export type ValidateCalendarYearInput = z.infer<typeof validateCalendarYearBodySchema>;
