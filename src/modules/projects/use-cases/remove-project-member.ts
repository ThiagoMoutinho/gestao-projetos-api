import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { isProtectedOwnerMembership } from "../projects.authorization";
import type { ProjectRepos, TransactionRunner } from "../repositories/contracts";
import { assertCanManageMembers, loadProjectAccess } from "./shared";

export function makeRemoveProjectMemberUseCase(deps: {
  repos: ProjectRepos;
  runInTransaction: TransactionRunner;
}) {
  return async function removeProjectMember(
    actor: AuthUser,
    projectId: string,
    memberId: string,
  ) {
    const { project, context } = await loadProjectAccess(
      deps.repos,
      actor,
      projectId,
    );
    assertCanManageMembers(context);

    const member = await deps.repos.members.findByIdAndProject(memberId, projectId);
    if (!member) {
      throw new HttpError(
        404,
        "Participante não encontrado.",
        "PROJECT_MEMBER_NOT_FOUND",
      );
    }

    if (isProtectedOwnerMembership(project.ownerId, member.userId, member.role)) {
      throw new HttpError(
        409,
        "O dono principal não pode ser removido enquanto for titular do projeto.",
        "PROJECT_OWNER_MEMBER_PROTECTED",
      );
    }

    const memberUser = await deps.repos.users.findById(member.userId);

    await deps.runInTransaction(async (txRepos) => {
      await txRepos.members.deleteById(memberId);

      await txRepos.audit.create({
        projectId,
        entityType: "PROJECT_MEMBER",
        entityId: member.id,
        action: "MEMBER_REMOVE",
        summary: `${memberUser?.name ?? "Participante"} removido(a) da função ${member.role} no projeto.`,
        payload: {
          memberId: member.id,
          userId: member.userId,
          userName: memberUser?.name ?? null,
          role: member.role,
        },
        actorId: actor.id,
      });
    });
  };
}
