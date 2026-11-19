import { HttpError } from "../../../lib/http-error";
import { UniqueConstraintError } from "../../../lib/postgres-errors";
import type { AuthUser } from "../../../lib/session";
import type { AddProjectMemberInput } from "../dtos/projects.dto";
import { toProjectMemberDto } from "../dtos/projects.dto";
import type { ProjectRepos, TransactionRunner } from "../repositories/contracts";
import {
  assertCanManageMembers,
  duplicateMemberError,
  loadProjectAccess,
  resolveMemberFunction,
} from "./shared";

export function makeAddProjectMemberUseCase(deps: {
  repos: ProjectRepos;
  runInTransaction: TransactionRunner;
}) {
  return async function addProjectMember(
    actor: AuthUser,
    projectId: string,
    input: AddProjectMemberInput,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanManageMembers(context);

    const memberUser = await deps.repos.users.findById(input.userId);
    if (!memberUser) {
      throw new HttpError(404, "Usuário não encontrado.", "USER_NOT_FOUND");
    }

    const memberFunction = await resolveMemberFunction(deps.repos, input.role, input.functionId);

    const duplicate = await deps.repos.members.findByProjectUserRole(
      projectId,
      input.userId,
      input.role,
    );

    if (duplicate) {
      throw duplicateMemberError();
    }

    try {
      const created = await deps.runInTransaction(async (txRepos) => {
        const row = await txRepos.members.create({
          id: crypto.randomUUID(),
          projectId,
          userId: input.userId,
          role: input.role,
          functionId: memberFunction?.id ?? null,
        });

        await txRepos.audit.create({
          projectId,
          entityType: "PROJECT_MEMBER",
          entityId: row.id,
          action: "MEMBER_ADD",
          summary: `${memberUser.name} incluído(a) no projeto como ${memberFunction ? `${memberFunction.name} (${row.role})` : row.role}.`,
          payload: {
            memberId: row.id,
            userId: row.userId,
            userName: memberUser.name,
            role: row.role,
            ...(memberFunction ? { functionId: memberFunction.id, functionName: memberFunction.name } : {}),
          },
          actorId: actor.id,
        });

        return row;
      });

      return toProjectMemberDto(created, memberUser, memberFunction);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw duplicateMemberError();
      }

      throw error;
    }
  };
}
