import type { Database, DbClient } from "../../../db/types";
import { DrizzleEapEvidencesRepository } from "../../eap/repositories/eap-evidences.repository";
import { DrizzleProjectAuditRepository } from "../../projects/repositories/project-audit.repository";
import { DrizzleProjectMembersRepository } from "../../projects/repositories/project-members.repository";
import { DrizzleProjectsRepository } from "../../projects/repositories/projects.repository";
import { DrizzleUsersRepository } from "../../projects/repositories/users.repository";
import { parseGlpiBaseUrl } from "../dtos/institutional.dto";
import { makeInstitutionalController } from "../institutional.controller";
import type { InstitutionalRepos, InstitutionalTransactionRunner } from "../repositories/contracts";
import { DrizzleInstitutionalRepository } from "../repositories/institutional.repository";
import { makeDecideProfileFieldUseCase } from "../use-cases/decide-profile-field";
import { makeArchiveResultUseCase, makeDecideResultUseCase } from "../use-cases/decide-result";
import { makeGetProjectOverviewUseCase } from "../use-cases/get-project-overview";
import { makeRemoveHighlightUseCase, makeSetHighlightUseCase } from "../use-cases/highlights";
import { makeSaveProfileFieldUseCase } from "../use-cases/save-profile-field";
import { makeRegisterResultEvidenceUseCase } from "../use-cases/result-evidence";
import { makeCreateResultUseCase, makeUpdateResultUseCase } from "../use-cases/save-result";

export function makeInstitutionalRepos(client: DbClient): InstitutionalRepos {
  return {
    projects: new DrizzleProjectsRepository(client),
    members: new DrizzleProjectMembersRepository(client),
    users: new DrizzleUsersRepository(client),
    audit: new DrizzleProjectAuditRepository(client),
    institutional: new DrizzleInstitutionalRepository(client),
    evidences: new DrizzleEapEvidencesRepository(client),
  };
}

export function makeInstitutionalModule(database: Database) {
  const repos = makeInstitutionalRepos(database);
  const runInTransaction: InstitutionalTransactionRunner = (fn) =>
    database.transaction((tx) => fn(makeInstitutionalRepos(tx)));
  const deps = { repos, runInTransaction };
  // Links dos chamados só existem com a URL base do GLPI configurada e válida.
  const glpiBaseUrl = parseGlpiBaseUrl(process.env.GLPI_BASE_URL);

  return makeInstitutionalController({
    getProjectOverview: makeGetProjectOverviewUseCase({ repos, glpiBaseUrl }),
    saveProfileField: makeSaveProfileFieldUseCase(deps),
    decideProfileField: makeDecideProfileFieldUseCase(deps),
    createResult: makeCreateResultUseCase(deps),
    updateResult: makeUpdateResultUseCase(deps),
    decideResult: makeDecideResultUseCase(deps),
    archiveResult: makeArchiveResultUseCase(deps),
    registerResultEvidence: makeRegisterResultEvidenceUseCase(deps),
    setHighlight: makeSetHighlightUseCase(deps),
    removeHighlight: makeRemoveHighlightUseCase(deps),
  });
}
