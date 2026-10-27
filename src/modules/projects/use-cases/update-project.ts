import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import type { UpdateProjectInput } from "../dtos/projects.dto";
import { toProjectDetail } from "../dtos/projects.dto";
import { canTransferOwnership } from "../projects.authorization";
import type { ProjectRepos, TransactionRunner } from "../repositories/contracts";
import {
  assertCanUpdate,
  loadProjectAccess,
  ownerNotFoundError,
  recordOwnerTransfer,
  recordProjectStatusChange,
} from "./shared";

export function makeUpdateProjectUseCase(deps: {
  repos: ProjectRepos;
  runInTransaction: TransactionRunner;
}) {
  return async function updateProject(
    actor: AuthUser,
    projectId: string,
    input: UpdateProjectInput,
  ) {
    const { project, context } = await loadProjectAccess(
      deps.repos,
      actor,
      projectId,
    );
    assertCanUpdate(context);

    const ownerIdChanged = Boolean(input.ownerId && input.ownerId !== project.ownerId);
    const statusChanged = input.status !== undefined && input.status !== project.status;
    // Concluído só pelo encerramento formal (POST /projects/:id/closure), que confere a elegibilidade;
    // depois de concluído, a situação não volta pela edição comum.
    if (statusChanged && input.status === "CONCLUIDO") {
      throw new HttpError(
        400,
        "Para concluir o projeto, use o encerramento formal, que confere se ele está apto.",
        "PROJECT_CLOSURE_REQUIRES_FLOW",
      );
    }
    if (statusChanged && project.status === "CONCLUIDO") {
      throw new HttpError(409, "Projeto concluído não pode ter a situação alterada pela edição.", "PROJECT_ALREADY_CLOSED");
    }
    let ownerTransfer: { from: { id: string; name: string | null }; to: { id: string; name: string } } | null =
      null;

    if (ownerIdChanged) {
      if (!canTransferOwnership(context)) {
        throw new HttpError(
          403,
          "Você não tem permissão para transferir o dono do projeto.",
          "PROJECT_OWNER_TRANSFER_FORBIDDEN",
        );
      }

      const nextOwner = await deps.repos.users.findById(input.ownerId!);
      if (!nextOwner) {
        throw ownerNotFoundError();
      }

      const previousOwner = await deps.repos.users.findById(project.ownerId);
      ownerTransfer = {
        from: { id: project.ownerId, name: previousOwner?.name ?? null },
        to: { id: nextOwner.id, name: nextOwner.name },
      };
    }

    const updated = await deps.runInTransaction(async (txRepos) => {
      const row = await txRepos.projects.update(projectId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.glpiTicketId !== undefined
          ? { glpiTicketId: input.glpiTicketId }
          : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      });

      if (!row) {
        throw new HttpError(404, "Projeto não encontrado.", "PROJECT_NOT_FOUND");
      }

      if (ownerIdChanged && input.ownerId) {
        await txRepos.members.ensureOwnerMembership(projectId, input.ownerId);
        await txRepos.members.deleteOwnerRole(projectId, project.ownerId);
      }

      if (ownerTransfer) {
        await recordOwnerTransfer(txRepos, { projectId, ...ownerTransfer, actorId: actor.id });
      }

      if (statusChanged) {
        await recordProjectStatusChange(txRepos, {
          projectId,
          from: project.status,
          to: row.status,
          actorId: actor.id,
        });
      }

      return row;
    });

    const owner = await deps.repos.users.findById(updated.ownerId);
    if (!owner) {
      throw ownerNotFoundError();
    }

    const roles = await deps.repos.members.findRoles(updated.id, actor.id);
    return toProjectDetail(updated, owner, actor.id, roles);
  };
}
