import type { AuthUser } from "../../../lib/session";
import type { ProjectRepos } from "../repositories/contracts";
import { assertCanManageMembers, loadProjectAccess } from "./shared";

export type MemberCandidateDto = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/** Fonte dos usuários que podem ser vinculados à equipe de um projeto (somente ativos). */
export interface MemberCandidatesRepository {
  listActive(): Promise<MemberCandidateDto[]>;
}

/**
 * Usuários ativos que podem compor a equipe do projeto. Mesma regra de quem gerencia participantes
 * (canManageProjectMembers): quem não pode gerenciar recebe 403, e o frontend usa isso para não exibir a edição.
 */
export function makeListMemberCandidatesUseCase(deps: {
  repos: ProjectRepos;
  candidates: MemberCandidatesRepository;
}) {
  return async function listMemberCandidates(actor: AuthUser, projectId: string) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanManageMembers(context);

    const rows = await deps.candidates.listActive();
    return {
      data: [...rows].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    };
  };
}
