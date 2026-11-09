import type { AuthUser } from "../../../lib/session";
import { isRescheduleEntry, toEapScheduleChangeDto, type ListProjectReschedulesQuery } from "../dtos/eap-schedule.dto";
import type { EapRepos } from "../repositories/contracts";
import { assertCanView, loadProjectAccess } from "./shared";

/**
 * Reprogramações efetivadas do projeto inteiro (qualquer item), da mais recente para a mais antiga. Somente leitura sobre
 * a auditoria (`SCHEDULE_CHANGE`): a primeira definição de datas não conta como reprogramação, e nada aqui é solicitação
 * pendente. `total` e `lastAt` valem para todo o histórico; `limit` só reduz a lista devolvida.
 */
export function makeListProjectReschedulesUseCase(deps: { repos: EapRepos }) {
  return async function listProjectReschedules(
    actor: AuthUser,
    projectId: string,
    query: ListProjectReschedulesQuery,
  ) {
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);

    const [rows, phases, tasks, milestones] = await Promise.all([
      deps.repos.audit.listByAction({ projectId, action: "SCHEDULE_CHANGE" }),
      deps.repos.phases.listByProject(projectId),
      deps.repos.tasks.listByProject(projectId),
      deps.repos.milestones.listByProject(projectId),
    ]);

    const titles = new Map<string, string>([
      ...phases.map((phase) => [`PHASE:${phase.id}`, phase.name] as const),
      ...tasks.map((task) => [`TASK:${task.id}`, task.title] as const),
      ...milestones.map((milestone) => [`MILESTONE:${milestone.id}`, milestone.title] as const),
    ]);

    // A auditoria vem em ordem cronológica; o painel mostra do mais recente para o mais antigo.
    const all = rows
      .filter(isRescheduleEntry)
      .map(toEapScheduleChangeDto)
      .reverse()
      .map((entry) => ({
        ...entry,
        // Item excluído depois da reprogramação: o registro permanece, sem título.
        entityTitle: entry.entityType === "PROJECT" ? null : (titles.get(`${entry.entityType}:${entry.entityId}`) ?? null),
      }));

    return {
      total: all.length,
      lastAt: all[0]?.createdAt ?? null,
      data: query.limit ? all.slice(0, query.limit) : all,
    };
  };
}
