import { z } from "zod";

import { errorResponseSchema } from "../../lib/http-error";

/** Widgets da Visão Geral que podem ser reordenados. A lista é fixa: o cliente não cria widgets novos. */
export const OVERVIEW_WIDGET_IDS = ["sobre", "resultados", "evolucoes", "situacao", "marcos", "historico", "resumo", "planejamento", "evidencias", "equipe", "conformidade"] as const;

/** Altura do widget: automática (acompanha o conteúdo) ou limite fixo com rolagem interna. Ausente = automática. */
export const OVERVIEW_WIDGET_HEIGHTS = ["auto", "compacta", "media", "alta"] as const;

export const overviewWidgetSchema = z.object({
  id: z.enum(OVERVIEW_WIDGET_IDS),
  wide: z.boolean(),
  height: z.enum(OVERVIEW_WIDGET_HEIGHTS).optional(),
});

export const overviewLayoutBodySchema = z
  .object({
    widgets: z
      .array(overviewWidgetSchema)
      .min(1)
      .max(OVERVIEW_WIDGET_IDS.length)
      .refine((items) => new Set(items.map((item) => item.id)).size === items.length, { message: "Widgets repetidos." }),
  })
  .strict();

export const overviewLayoutResponseSchema = z.object({
  widgets: z.array(overviewWidgetSchema).nullable(),
});

export const overviewLayoutErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
};

export type OverviewLayoutDto = z.infer<typeof overviewLayoutResponseSchema>;
export type OverviewWidget = z.infer<typeof overviewWidgetSchema>;
