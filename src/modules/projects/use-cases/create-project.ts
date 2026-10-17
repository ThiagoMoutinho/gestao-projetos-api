import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { toProjectDetail } from "../dtos/projects.dto";
import type { CreateProjectInput } from "../dtos/projects.dto";
import {
  canAssignProjectOwner,
  canCreateProject,
} from "../projects.authorization";
import type { ProjectRepos, TransactionRunner } from "../repositories/contracts";
import { ownerNotFoundError } from "./shared";

export function makeCreateProjectUseCase(deps: {
  repos: ProjectRepos;
  runInTransaction: TransactionRunner;
}) {
  return async function createProject(actor: AuthUser, input: CreateProjectInput) {
    if (!canCreateProject(actor.role)) {
      throw new HttpError(
        403,
        "Você não tem permissão para cadastrar projetos.",
        "PROJECT_CREATE_FORBIDDEN",
      );
    }

    const ownerId = input.ownerId ?? actor.id;

    if (ownerId !== actor.id && !canAssignProjectOwner(actor.role)) {
      throw new HttpError(
        403,
        "Você não pode definir outro usuário como dono do projeto.",
        "PROJECT_OWNER_ASSIGN_FORBIDDEN",
      );
    }

    const owner = await deps.repos.users.findById(ownerId);
    if (!owner) {
      throw ownerNotFoundError();
    }

    const created = await deps.runInTransaction(async (txRepos) => {
      const project = await txRepos.projects.create({
        id: crypto.randomUUID(),
        name: input.name,
        description: input.description ?? null,
        glpiTicketId: input.glpiTicketId ?? null,
        ownerId,
        status: input.status ?? "NAO_INICIADO",
      });

      await txRepos.members.ensureOwnerMembership(project.id, ownerId);
      return project;
    });

    const roles =
      actor.id === created.ownerId
        ? (["DONO_PROJETO"] as const)
        : await deps.repos.members.findRoles(created.id, actor.id);

    return toProjectDetail(created, owner, actor.id, [...roles]);
  };
}
