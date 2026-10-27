import type { Database, DbClient } from "../../../db/types";
import { DrizzleProjectMembersRepository } from "../../projects/repositories/project-members.repository";
import { DrizzleProjectsRepository } from "../../projects/repositories/projects.repository";
import { DrizzleUsersRepository } from "../../projects/repositories/users.repository";
import { makeEapController } from "../eap.controller";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import { DrizzleEapAuditRepository } from "../repositories/eap-audit.repository";
import { DrizzleEapEvidencesRepository } from "../repositories/eap-evidences.repository";
import { DrizzleEapImpedimentsRepository } from "../repositories/eap-impediments.repository";
import { DrizzleEapMilestoneDeliveriesRepository } from "../repositories/eap-milestone-deliveries.repository";
import { DrizzleEapMilestonesRepository } from "../repositories/eap-milestones.repository";
import { DrizzleEapPhasesRepository } from "../repositories/eap-phases.repository";
import { DrizzleEapScheduleRequestsRepository } from "../repositories/eap-schedule-requests.repository";
import { DrizzleEapTasksRepository } from "../repositories/eap-tasks.repository";
import { makeAuthorizeResubmissionUseCase } from "../use-cases/authorize-resubmission";
import { makeCancelTaskUseCase } from "../use-cases/cancel-task";
import { makeCreateEvidenceUseCase } from "../use-cases/create-evidence";
import { makeCreateMilestoneUseCase } from "../use-cases/create-milestone";
import { makeCreatePhaseUseCase } from "../use-cases/create-phase";
import { makeCreateTaskUseCase } from "../use-cases/create-task";
import { makeDeleteMilestoneUseCase } from "../use-cases/delete-milestone";
import { makeDeletePhaseUseCase } from "../use-cases/delete-phase";
import { makeDeleteTaskUseCase } from "../use-cases/delete-task";
import { makeDeliverMilestoneUseCase } from "../use-cases/deliver-milestone";
import { makeGetEvidenceUseCase } from "../use-cases/get-evidence";
import { makeGetMilestoneUseCase } from "../use-cases/get-milestone";
import { makeGetPhaseUseCase } from "../use-cases/get-phase";
import { makeGetTaskUseCase } from "../use-cases/get-task";
import { makeGetScheduleMonitoringUseCase } from "../use-cases/get-schedule-monitoring";
import { makeListAuditUseCase } from "../use-cases/list-audit";
import { makeListScheduleChangesUseCase } from "../use-cases/list-schedule-changes";
import { makeRescheduleUseCase } from "../use-cases/reschedule";
import { makeListEvidencesUseCase } from "../use-cases/list-evidences";
import { makeListImpedimentsUseCase } from "../use-cases/list-impediments";
import { makeListMilestoneDeliveriesUseCase } from "../use-cases/list-milestone-deliveries";
import { makeListMilestonesUseCase } from "../use-cases/list-milestones";
import { makeListPhasesUseCase } from "../use-cases/list-phases";
import { makeListTasksUseCase } from "../use-cases/list-tasks";
import { makeReactivateTaskUseCase } from "../use-cases/reactivate-task";
import { makeRegisterImpedimentUseCase } from "../use-cases/register-impediment";
import { makeReorderMilestonesUseCase } from "../use-cases/reorder-milestones";
import { makeReorderPhasesUseCase } from "../use-cases/reorder-phases";
import { makeImportEapUseCase } from "../use-cases/import-eap";
import { makeCloseProjectUseCase } from "../use-cases/close-project";
import { makeReorderTasksUseCase } from "../use-cases/reorder-tasks";
import { makeResolveImpedimentUseCase } from "../use-cases/resolve-impediment";
import { makeReviewMilestoneUseCase } from "../use-cases/review-milestone";
import { makeUpdateEvidenceUseCase } from "../use-cases/update-evidence";
import { makeUpdateImpedimentUseCase } from "../use-cases/update-impediment";
import { makeUpdateMilestoneUseCase } from "../use-cases/update-milestone";
import { makeUpdatePhaseUseCase } from "../use-cases/update-phase";
import { makeUpdateTaskProgressUseCase } from "../use-cases/update-task-progress";
import { makeUpdateTaskUseCase } from "../use-cases/update-task";

export function makeEapRepos(client: DbClient): EapRepos {
  return {
    projects: new DrizzleProjectsRepository(client),
    members: new DrizzleProjectMembersRepository(client),
    users: new DrizzleUsersRepository(client),
    phases: new DrizzleEapPhasesRepository(client),
    tasks: new DrizzleEapTasksRepository(client),
    milestones: new DrizzleEapMilestonesRepository(client),
    deliveries: new DrizzleEapMilestoneDeliveriesRepository(client),
    scheduleRequests: new DrizzleEapScheduleRequestsRepository(client),
    impediments: new DrizzleEapImpedimentsRepository(client),
    evidences: new DrizzleEapEvidencesRepository(client),
    audit: new DrizzleEapAuditRepository(client),
  };
}

export function makeEapModule(database: Database) {
  const repos = makeEapRepos(database);

  const runInTransaction: EapTransactionRunner = (fn) =>
    database.transaction((tx) => fn(makeEapRepos(tx)));

  const deps = { repos, runInTransaction };

  return makeEapController({
    listPhases: makeListPhasesUseCase(deps),
    getPhase: makeGetPhaseUseCase(deps),
    createPhase: makeCreatePhaseUseCase(deps),
    updatePhase: makeUpdatePhaseUseCase(deps),
    reorderPhases: makeReorderPhasesUseCase(deps),
    importEap: makeImportEapUseCase(deps),
    closeProject: makeCloseProjectUseCase(deps),
    listTasks: makeListTasksUseCase(deps),
    getTask: makeGetTaskUseCase(deps),
    createTask: makeCreateTaskUseCase(deps),
    updateTask: makeUpdateTaskUseCase(deps),
    updateTaskProgress: makeUpdateTaskProgressUseCase(deps),
    cancelTask: makeCancelTaskUseCase(deps),
    reactivateTask: makeReactivateTaskUseCase(deps),
    reorderTasks: makeReorderTasksUseCase(deps),
    listImpediments: makeListImpedimentsUseCase(deps),
    registerImpediment: makeRegisterImpedimentUseCase(deps),
    updateImpediment: makeUpdateImpedimentUseCase(deps),
    resolveImpediment: makeResolveImpedimentUseCase(deps),
    listMilestones: makeListMilestonesUseCase(deps),
    getMilestone: makeGetMilestoneUseCase(deps),
    createMilestone: makeCreateMilestoneUseCase(deps),
    updateMilestone: makeUpdateMilestoneUseCase(deps),
    deliverMilestone: makeDeliverMilestoneUseCase(deps),
    reviewMilestone: makeReviewMilestoneUseCase(deps),
    authorizeResubmission: makeAuthorizeResubmissionUseCase(deps),
    listMilestoneDeliveries: makeListMilestoneDeliveriesUseCase(deps),
    reorderMilestones: makeReorderMilestonesUseCase(deps),
    listEvidences: makeListEvidencesUseCase(deps),
    getEvidence: makeGetEvidenceUseCase(deps),
    createEvidence: makeCreateEvidenceUseCase(deps),
    updateEvidence: makeUpdateEvidenceUseCase(deps),
    listAudit: makeListAuditUseCase(deps),
    reschedule: makeRescheduleUseCase(deps),
    listScheduleChanges: makeListScheduleChangesUseCase(deps),
    getScheduleMonitoring: makeGetScheduleMonitoringUseCase(deps),
    deletePhase: makeDeletePhaseUseCase(deps),
    deleteTask: makeDeleteTaskUseCase(deps),
    deleteMilestone: makeDeleteMilestoneUseCase(deps),
  });
}
