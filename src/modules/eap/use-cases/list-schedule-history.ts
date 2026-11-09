import type { AuthUser } from "../../../lib/session";
import { isScheduleChangeEntry, toEapScheduleChangeDto } from "../dtos/eap-schedule.dto";
import type { EapRepos } from "../repositories/contracts";
import type { ListScheduleHistoryQuery } from "../schemas/eap-schedule-history.schema";
import { buildScheduleHistory } from "./schedule-history";
import { assertCanView, loadProjectAccess } from "./shared";

/**
 * Histórico unificado de cronograma do projeto (reprogramações, solicitações e definições iniciais). Somente leitura:
 * não grava nada, não altera datas, linha de base, atrasos nem a auditoria.
 */
export function makeListScheduleHistoryUseCase(deps: { repos: EapRepos }) {
  return async function listScheduleHistory(actor: AuthUser, projectId: string, query: ListScheduleHistoryQuery) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);

    const [rows, requests, changes, phases, tasks, milestones] = await Promise.all([
      deps.repos.audit.listByAction({ projectId, action: "SCHEDULE_CHANGE" }),
      deps.repos.scheduleRequests.listByProject(projectId),
      deps.repos.scheduleRequests.listChangesByProject(projectId),
      deps.repos.phases.listByProject(projectId),
      deps.repos.tasks.listByProject(projectId),
      deps.repos.milestones.listByProject(projectId),
    ]);

    const audit = rows.filter(isScheduleChangeEntry).map((row) => {
      const requestId = (row.payload as Record<string, unknown> | null)?.requestId;
      return { dto: toEapScheduleChangeDto(row), requestId: typeof requestId === "string" ? requestId : null };
    });

    const titles = new Map<string, string>([
      ...phases.map((phase) => [`PHASE:${phase.id}`, phase.name] as const),
      ...tasks.map((task) => [`TASK:${task.id}`, task.title] as const),
      ...milestones.map((milestone) => [`MILESTONE:${milestone.id}`, milestone.title] as const),
    ]);

    const personIds = new Set<string>();
    for (const entry of audit) personIds.add(entry.dto.actorId);
    for (const request of requests) {
      personIds.add(request.requestedBy);
      if (request.reviewedBy) personIds.add(request.reviewedBy);
    }
    const people = new Map(
      (await Promise.all([...personIds].map((id) => deps.repos.users.findById(id)))).flatMap((person) =>
        person ? [[person.id, { id: person.id, name: person.name }] as const] : [],
      ),
    );

    return buildScheduleHistory(
      {
        audit,
        requests,
        changes,
        titleOf: (entityType, entityId) => titles.get(`${entityType}:${entityId}`) ?? null,
        personOf: (id) => (id ? (people.get(id) ?? null) : null),
      },
      query,
    );
  };
}
