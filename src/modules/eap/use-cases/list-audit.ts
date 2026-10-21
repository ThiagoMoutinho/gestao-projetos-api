import type { AuthUser } from "../../../lib/session";
import type { ListAuditQuery } from "../dtos/eap-audit.dto";
import { toEapAuditEntryDto } from "../dtos/eap-audit.dto";
import type { EapRepos } from "../repositories/contracts";
import {
  assertCanView,
  loadProjectAccess,
  milestoneNotFoundError,
  phaseNotFoundError,
  taskNotFoundError,
} from "./shared";

const DEFAULT_LIMIT = 50;

async function assertEntityInProject(repos: EapRepos, projectId: string, query: ListAuditQuery) {
  if (query.entityType === "PHASE") {
    const phase = await repos.phases.findByIdAndProject(query.entityId, projectId);
    if (!phase) {
      throw phaseNotFoundError();
    }
    return;
  }

  if (query.entityType === "TASK") {
    const task = await repos.tasks.findById(query.entityId);
    const phase = task ? await repos.phases.findById(task.phaseId) : null;
    if (!task || !phase || phase.projectId !== projectId) {
      throw taskNotFoundError();
    }
    return;
  }

  const milestone = await repos.milestones.findById(query.entityId);
  const phase = milestone ? await repos.phases.findById(milestone.phaseId) : null;
  if (!milestone || !phase || phase.projectId !== projectId) {
    throw milestoneNotFoundError();
  }
}

export function makeListAuditUseCase(deps: { repos: EapRepos }) {
  return async function listAudit(actor: AuthUser, projectId: string, query: ListAuditQuery) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    await assertEntityInProject(deps.repos, projectId, query);

    const rows = await deps.repos.audit.listByEntity({
      projectId,
      entityType: query.entityType,
      entityId: query.entityId,
      includeEvidences: true,
      limit: query.limit ?? DEFAULT_LIMIT,
    });

    return { data: rows.map(toEapAuditEntryDto) };
  };
}
