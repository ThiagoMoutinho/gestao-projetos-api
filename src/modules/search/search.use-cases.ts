import type { AuthUser } from "../../lib/session";
import type { SearchRepository, SearchScope } from "./search.repository";
import { SEARCH_KINDS, type SearchResponse } from "./search.schema";
import { MIN_QUERY_LENGTH, searchWords } from "./search.text";

/** Mesmos papéis da lista de todos os projetos (projects.authorization): ADMIN, PMO e COORDENADOR. */
const WIDE_ROLES: ReadonlyArray<AuthUser["role"]> = ["ADMIN", "PMO", "COORDENADOR"];

export function makeSearchUseCases(repo: SearchRepository) {
  return {
    /**
     * Busca global (projetos, chamados GLPI, atas, EAP, evidências, entregas, textos publicados, impedimentos e pessoas).
     * O escopo vem do servidor e nunca do cliente: quem não enxerga todos os projetos só alcança os próprios (dono ou
     * membro) e não pesquisa pessoas.
     */
    async search(actor: AuthUser, query: string, perKind: number): Promise<SearchResponse> {
      const trimmed = query.trim();
      const words = searchWords(trimmed);
      if (trimmed.length < MIN_QUERY_LENGTH || words.length === 0) {
        return { query: trimmed, perKind, items: [] };
      }
      const wide = WIDE_ROLES.includes(actor.role);
      const scope: SearchScope = wide ? { all: true } : { all: false, userId: actor.id };
      const found = await repo.search({ words, scope, perKind, includePeople: wide });
      const order = new Map<string, number>(SEARCH_KINDS.map((kind, index) => [kind, index]));
      const items = found
        .map((entry, index) => ({ entry, index }))
        .sort((left, right) => (order.get(left.entry.kind) ?? 99) - (order.get(right.entry.kind) ?? 99) || left.index - right.index)
        .map(({ entry }) => entry);
      return { query: trimmed, perKind, items };
    },
  };
}

export type SearchUseCases = ReturnType<typeof makeSearchUseCases>;
