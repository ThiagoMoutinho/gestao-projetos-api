import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { toProjectDetail } from "../dtos/projects.dto";
import { canTransferOwnership } from "../projects.authorization";
import type { ProjectRepos, TransactionRunner } from "../repositories/contracts";
import { loadProjectAccess, ownerNotFoundError, recordOwnerTransfer } from "./shared";

export function makeTransferProjectOwnerUseCase(deps: {
  repos: ProjectRepos;
  runInTransaction: TransactionRunner;
}) {
  return async function transferProjectOwner(
    actor: AuthUser,
    projectId: string,
    newOwnerId: string,
  ) {
    const { project, context } = await loadProjectAccess(
      deps.repos,
      actor,
      projectId,
    );

    if (newOwnerId === project.ownerId) {
      const owner = await deps.repos.users.findById(project.ownerId);
      if (!owner) {
        throw ownerNotFoundError();
      }

      return toProjectDetail(project, owner, actor.id, [...context.memberRoles]);
    }

    if (!canTransferOwnership(context)) {
      throw new HttpError(
        403,
        "Você não tem permissão para transferir o dono do projeto.",
        "PROJECT_OWNER_TRANSFER_FORBIDDEN",
      );
    }

    const nextOwner = await deps.repos.users.findById(newOwnerId);
    if (!nextOwner) {
      throw ownerNotFoundError();
    }

    const previousOwner = await deps.repos.users.findById(project.ownerId);

    const updated = await deps.runInTransaction(async (txRepos) => {
      const row = await txRepos.projects.update(projectId, {
        ownerId: newOwnerId,
        updatedAt: new Date(),
      });

      if (!row) {
        throw new HttpError(404, "Projeto não encontrado.", "PROJECT_NOT_FOUND");
      }

      await txRepos.members.ensureOwnerMembership(projectId, newOwnerId);
      await txRepos.members.deleteOwnerRole(projectId, project.ownerId);
      await recordOwnerTransfer(txRepos, {
        projectId,
        from: { id: project.ownerId, name: previousOwner?.name ?? null },
        to: { id: nextOwner.id, name: nextOwner.name },
        actorId: actor.id,
      });
      return row;
    });

    const roles = await deps.repos.members.findRoles(updated.id, actor.id);
    return toProjectDetail(updated, nextOwner, actor.id, roles);
  };
}
