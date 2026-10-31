import type { AuthUser } from "../../lib/session";
import type { OverviewLayoutRepository } from "./overview-layout.repository";
import type { OverviewLayoutDto, OverviewWidget } from "./overview-layout.schema";

/** Cada usuário lê e altera só o próprio layout; não há leitura nem escrita sobre o layout de outra pessoa. */
export function makeOverviewLayoutUseCases(repo: OverviewLayoutRepository) {
  return {
    async get(actor: AuthUser): Promise<OverviewLayoutDto> {
      return { widgets: await repo.find(actor.id) };
    },
    async save(actor: AuthUser, widgets: OverviewWidget[]): Promise<OverviewLayoutDto> {
      await repo.save(actor.id, widgets);
      return { widgets };
    },
    async reset(actor: AuthUser): Promise<OverviewLayoutDto> {
      await repo.remove(actor.id);
      return { widgets: null };
    },
  };
}

export type OverviewLayoutUseCases = ReturnType<typeof makeOverviewLayoutUseCases>;
