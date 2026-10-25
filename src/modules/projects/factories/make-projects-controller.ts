import type { Database, DbClient } from "../../../db/types";
import { makeProjectsController } from "../projects.controller";
import type { ProjectRepos, TransactionRunner } from "../repositories/contracts";
import { DrizzleProjectAuditRepository } from "../repositories/project-audit.repository";
import { DrizzleProjectMembersRepository } from "../repositories/project-members.repository";
import { DrizzleProjectsRepository } from "../repositories/projects.repository";
import { DrizzleUsersRepository } from "../repositories/users.repository";
import { makeAddProjectMemberUseCase } from "../use-cases/add-project-member";
import { makeCreateProjectUseCase } from "../use-cases/create-project";
import { makeGetProjectUseCase } from "../use-cases/get-project";
import { makeListMyProjectsUseCase } from "../use-cases/list-my-projects";
import { makeListProjectMembersUseCase } from "../use-cases/list-project-members";
import { makeListProjectsUseCase } from "../use-cases/list-projects";
import { makeRemoveProjectMemberUseCase } from "../use-cases/remove-project-member";
import { makeTransferProjectOwnerUseCase } from "../use-cases/transfer-project-owner";
import { makeUpdateProjectMemberUseCase } from "../use-cases/update-project-member";
import { makeUpdateProjectUseCase } from "../use-cases/update-project";

export function makeProjectRepos(client: DbClient): ProjectRepos {
  return {
    projects: new DrizzleProjectsRepository(client),
    members: new DrizzleProjectMembersRepository(client),
    users: new DrizzleUsersRepository(client),
    audit: new DrizzleProjectAuditRepository(client),
  };
}

export function makeProjectsModule(database: Database) {
  const repos = makeProjectRepos(database);

  const runInTransaction: TransactionRunner = (fn) =>
    database.transaction((tx) => fn(makeProjectRepos(tx)));

  const deps = { repos, runInTransaction };

  return makeProjectsController({
    createProject: makeCreateProjectUseCase(deps),
    listProjects: makeListProjectsUseCase(deps),
    listMyProjects: makeListMyProjectsUseCase(deps),
    getProject: makeGetProjectUseCase(deps),
    updateProject: makeUpdateProjectUseCase(deps),
    transferProjectOwner: makeTransferProjectOwnerUseCase(deps),
    listProjectMembers: makeListProjectMembersUseCase(deps),
    addProjectMember: makeAddProjectMemberUseCase(deps),
    updateProjectMember: makeUpdateProjectMemberUseCase(deps),
    removeProjectMember: makeRemoveProjectMemberUseCase(deps),
  });
}
