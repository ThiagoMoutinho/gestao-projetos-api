import { z } from "zod";

const cell = z.string().trim().max(4000).nullable().optional();

export const importEapBodySchema = z
  .object({
    fileName: z.string().trim().max(255).nullable().optional(),
    rows: z
      .array(
        z
          .object({
            line: z.number().int().min(1),
            code: z.string().trim().max(20),
            kind: z.string().trim().max(40),
            name: z.string().trim().max(255),
            description: cell,
            responsible: cell,
            reviewer: cell,
            milestoneType: cell,
            plannedStart: cell,
            plannedEnd: cell,
            completionCriteria: cell,
          })
          .strict(),
      )
      .min(1, "A planilha não tem linhas para importar.")
      .max(500, "Importe no máximo 500 linhas por vez."),
    confirm: z
      .boolean()
      .describe("false valida e devolve a pré-visualização; true grava todos os itens numa única transação."),
  })
  .strict();

const kindSchema = z.enum(["PHASE", "TASK", "MILESTONE"]);
const issueSchema = z.object({ line: z.number(), field: z.string().nullable(), message: z.string() });

export const importEapResponseSchema = z.object({
  valid: z.boolean(),
  committed: z.boolean(),
  errors: z.array(issueSchema),
  warnings: z.array(issueSchema).describe("Avisos que não impedem a importação."),
  summary: z.object({ phases: z.number(), tasks: z.number(), milestones: z.number() }),
  items: z.array(
    z.object({
      line: z.number(),
      code: z.string(),
      finalCode: z.string(),
      kind: kindSchema,
      name: z.string(),
      parentCode: z.string().nullable(),
      responsibleName: z.string().nullable(),
      reviewerName: z.string().nullable(),
      plannedStartAt: z.string().nullable(),
      plannedEndAt: z.string().nullable(),
      consolidatedStartAt: z.string().nullable(),
      consolidatedEndAt: z.string().nullable(),
    }),
  ),
});
