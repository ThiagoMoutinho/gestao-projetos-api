import { z } from "zod";

import { errorResponseSchema } from "../../lib/http-error";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH } from "./search.text";

/** Tipos de resultado, na ordem em que aparecem. A lista é fixa: o cliente não cria tipos novos. */
export const SEARCH_KINDS = [
  "PROJECT",
  "GLPI",
  "MINUTES",
  "PHASE",
  "TASK",
  "MILESTONE",
  "EVIDENCE",
  "DELIVERY",
  "PROFILE",
  "RESULT",
  "IMPEDIMENT",
  "PERSON",
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Onde o resultado vive dentro do projeto: Visão Geral ou EAP. */
export const SEARCH_DESTINATIONS = ["OVERVIEW", "EAP"] as const;
export type SearchDestination = (typeof SEARCH_DESTINATIONS)[number];

export const MAX_PER_KIND = 10;
export const DEFAULT_PER_KIND = 5;

export const searchQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(MIN_QUERY_LENGTH, `Digite pelo menos ${MIN_QUERY_LENGTH} caracteres.`)
      .max(MAX_QUERY_LENGTH, `Use no máximo ${MAX_QUERY_LENGTH} caracteres.`),
    perKind: z.coerce.number().int().min(1).max(MAX_PER_KIND).default(DEFAULT_PER_KIND),
  })
  .strict();

export const searchResultSchema = z.object({
  kind: z.enum(SEARCH_KINDS),
  id: z.string(),
  title: z.string(),
  /** Linha de apoio: item/ordem de origem, situação ou trecho do texto encontrado. */
  detail: z.string().nullable(),
  projectId: z.string(),
  projectName: z.string(),
  destination: z.enum(SEARCH_DESTINATIONS),
});

export const searchResponseSchema = z.object({
  query: z.string(),
  perKind: z.number().int(),
  items: z.array(searchResultSchema),
});

export const searchErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
};

export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
