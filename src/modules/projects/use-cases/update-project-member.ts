import { HttpError } from "../../../lib/http-error";
import { UniqueConstraintError } from "../../../lib/postgres-errors";
import type { AuthUser } from "../../../lib/session";
import { toProjectMemberDto } from "../dtos/projects.dto";
import { isProtectedOwnerMembership } from "../projects.authorization";
import type { ProjectRepos, TransactionRunner } from "../repositories/contracts";
import type { ProjectMemberRole } from "../schemas/projects.schema";
import {
  assertCanManageMembers,
  duplicateMemberError,
  loadProjectAccess,
} from "./shared";

export function makeUpdateProjectMemberUseCase(deps: {
  repos: ProjectRepos;
  runInTransaction: TransactionRunner;
}) {
  return async function updateProjectMember(
    actor: AuthUser,
    projectId: string,
    memberId: string,
    input: { role: ProjectMemberRole },
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
        "A função de dono principal não pode ser alterada por este endpoint. Transfira a titularidade do projeto.",
        "PROJECT_OWNER_ROLE_PROTECTED",
      );
    }

    const duplicate = await deps.repos.members.findByProjectUserRole(
      projectId,
      member.userId,
      input.role,
    );

    if (duplicate && duplicate.id !== member.id) {
      throw duplicateMemberError();
    }

    try {
      const memberUser = await deps.repos.users.findById(member.userId);
      if (!memberUser) {
        throw new HttpError(404, "Usuário não encontrado.", "USER_NOT_FOUND");
      }

      if (member.role === input.role) {
        return toProjectMemberDto(member, memberUser);
      }

      const updated = await deps.runInTransaction(async (txRepos) => {
        const row = await txRepos.members.updateRole(memberId, input.role);

        await txRepos.audit.create({
          projectId,
          entityType: "PROJECT_MEMBER",
          entityId: row.id,
          action: "MEMBER_UPDATE",
          summary: `Função de ${memberUser.name} alterada de ${member.role} para ${row.role}.`,
          payload: {
            memberId: row.id,
            userId: row.userId,
            userName: memberUser.name,
            fromRole: member.role,
            toRole: row.role,
          },
          actorId: actor.id,
        });

        return row;
      });

      return toProjectMemberDto(updated, memberUser);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw duplicateMemberError();
      }

      throw error;
    }
  };
}
