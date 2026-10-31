import { z } from "zod";

import { projectSituationSchema } from "./eap-schedule.schema";

/**
 * Resumo executivo automático: retrato dos indicadores do projeto no momento da consulta, montado só com dados
 * existentes e frases predefinidas. Nada é gravado e nenhum texto é interpretado ou inventado.
 */
export const executiveSummarySchema = z.object({
  /** Data e hora de referência dos dados (momento da consulta). */
  generatedAt: z.string(),
  /** Falso quando o projeto ainda não tem fases com itens: não há dados suficientes para sintetizar. */
  hasData: z.boolean(),
  situation: projectSituationSchema,
  progress: z.object({
    basisPoints: z.number().int().nullable(),
    coverageBasisPoints: z.number().int().nullable(),
    phasesTotal: z.number().int(),
    phasesCalculated: z.number().int(),
  }),
  overdue: z.object({
    phases: z.number().int(),
    tasks: z.number().int(),
    milestones: z.number().int(),
    total: z.number().int(),
  }),
  impediments: z.number().int(),
  reschedules: z.object({
    total: z.number().int(),
    escalated: z.number().int(),
    affectingCriticalMilestones: z.number().int(),
  }),
  homologation: z.object({
    awaiting: z.number().int(),
    inCorrections: z.number().int(),
    rejected: z.number().int(),
  }),
  nextDeliveries: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      plannedAt: z.string(),
      overdue: z.boolean(),
      corrections: z.boolean(),
      phaseId: z.string(),
      phaseName: z.string().nullable(),
    }),
  ),
  movements: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      actorName: z.string().nullable(),
      kind: z.string(),
      automatic: z.boolean(),
      summary: z.string(),
    }),
  ),
  narrative: z.array(z.object({ key: z.string(), text: z.string() })),
});

export type ExecutiveSummaryDto = z.infer<typeof executiveSummarySchema>;
