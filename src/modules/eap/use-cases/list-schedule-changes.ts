import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import {
  isScheduleChangeEntry,
  toEapScheduleChangeDto,
  type ListScheduleChangesQuery,
} from "../dtos/eap-schedule.dto";
import type { EapRepos } from "../repositories/contracts";
import {
  assertCanView,
  loadProjectAccess,
  milestoneNotFoundError,
  phaseNotFoundError,
  taskNotFoundError,
} from "./shared";

async function assertEntityInProject(repos: EapRepos, projectId: string, query: ListScheduleChangesQuery) {
  switch (query.entityType) {
    case "PROJECT":
      if (query.entityId !== projectId) {
        throw new HttpError(404, "Projeto não encontrado.", "PROJECT_NOT_FOUND");
      }
      return;
    case "PHASE":
      if (!(await repos.phases.findByIdAndProject(query.entityId, projectId))) {
        throw phaseNotFoundError();
      }
      return;
    case "TASK": {
      const task = await repos.tasks.findById(query.entityId);
      const phase = task ? await repos.phases.findById(task.phaseId) : null;
      if (!task || phase?.projectId !== projectId) {
        throw taskNotFoundError();
      }
      return;
    }
    case "MILESTONE": {
      const milestone = await repos.milestones.findById(query.entityId);
      const phase = milestone ? await repos.phases.findById(milestone.phaseId) : null;
      if (!milestone || phase?.projectId !== projectId) {
        throw milestoneNotFoundError();
      }
    }
  }
}

/** Histórico de planejamento do item em ordem cronológica; somente leitura. */
export function makeListScheduleChangesUseCase(deps: { repos: EapRepos }) {
  return async function listScheduleChanges(
    actor: AuthUser,
    projectId: string,
    query: ListScheduleChangesQuery,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await assertEntityInProject(deps.repos, projectId, query);

    const rows = await deps.repos.audit.listByAction({
      projectId,
      action: "SCHEDULE_CHANGE",
      entityType: query.entityType,
      entityId: query.entityId,
    });

    return { data: rows.filter(isScheduleChangeEntry).map(toEapScheduleChangeDto) };
  };
}
