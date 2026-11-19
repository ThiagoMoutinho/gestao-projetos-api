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
  resolveMemberFunction,
} from "./shared";

export function makeUpdateProjectMemberUseCase(deps: {
  repos: ProjectRepos;
  runInTransaction: TransactionRunner;
}) {
  return async function updateProjectMember(
    actor: AuthUser,
    projectId: string,
    memberId: string,
    input: { role: ProjectMemberRole; functionId?: string | null },
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

    // Sem functionId, o acesso Observador mantém a função atual; qualquer outro acesso a limpa.
    const targetFunctionId =
      input.functionId !== undefined ? input.functionId : input.role === "OBSERVADOR" ? (member.functionId ?? null) : null;
    const memberFunction = await resolveMemberFunction(deps.repos, input.role, targetFunctionId, member.functionId ?? null);

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

      if (member.role === input.role && (memberFunction?.id ?? null) === (member.functionId ?? null)) {
        return toProjectMemberDto(member, memberUser, memberFunction);
      }

      const updated = await deps.runInTransaction(async (txRepos) => {
        const row = await txRepos.members.updateRole(memberId, input.role, memberFunction?.id ?? null);

        await txRepos.audit.create({
          projectId,
          entityType: "PROJECT_MEMBER",
          entityId: row.id,
          action: "MEMBER_UPDATE",
          summary: `Função de ${memberUser.name} alterada de ${member.role} para ${memberFunction ? `${memberFunction.name} (${row.role})` : row.role}.`,
          payload: {
            memberId: row.id,
            userId: row.userId,
            userName: memberUser.name,
            fromRole: member.role,
            toRole: row.role,
            // Só entra no registro quando uma função do catálogo participa da troca (o formato antigo não muda).
            ...((member.functionId ?? null) !== null || memberFunction
              ? {
                  fromFunctionId: member.functionId ?? null,
                  toFunctionId: memberFunction?.id ?? null,
                  toFunctionName: memberFunction?.name ?? null,
                }
              : {}),
          },
          actorId: actor.id,
        });

        return row;
      });

      return toProjectMemberDto(updated, memberUser, memberFunction);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw duplicateMemberError();
      }

      throw error;
    }
  };
}
