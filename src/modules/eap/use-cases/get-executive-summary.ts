import type { AuthUser } from "../../../lib/session";
import { toEapAuditEntryDto } from "../dtos/eap-audit.dto";
import { canViewProjectGovernanceAudit } from "../eap.authorization";
import type { EapRepos } from "../repositories/contracts";
import type { ExecutiveSummaryDto } from "../schemas/eap-executive-summary.schema";
import { buildNarrative, nextDeliveriesFrom, relevantMovements } from "./executive-summary-narrative";
import { makeGetScheduleMonitoringUseCase } from "./get-schedule-monitoring";
import { presentPhaseList } from "./phase-rollup";
import { assertCanView, loadProjectAccess } from "./shared";

/** Quantos registros recentes são examinados para achar as movimentações relevantes. */
const RECENT_WINDOW = 200;

const GOVERNANCE_ENTITY_TYPES = new Set(["PROJECT", "PROJECT_MEMBER", "PROJECT_PROFILE", "PROJECT_RESULT", "PROJECT_HIGHLIGHT"]);

/**
 * Resumo executivo automático (somente leitura, nada é gravado). Reaproveita o monitoramento de prazos (situação,
 * atrasos, reprogramações e homologação, com a mesma autorização de consulta), o cálculo de andamento das fases e do
 * projeto usado pela EAP e a auditoria do projeto. A narrativa só combina esses números com frases predefinidas.
 */
export function makeGetExecutiveSummaryUseCase(deps: { repos: EapRepos }) {
  const monitoringOf = makeGetScheduleMonitoringUseCase(deps);

  return async function getExecutiveSummary(
    actor: AuthUser,
    projectId: string,
    now = new Date(),
  ): Promise<ExecutiveSummaryDto> {
    // A consulta do monitoramento já confere o acesso ao projeto; o resumo mantém a mesma regra.
    const monitoring = await monitoringOf(actor, projectId, now);
    const { context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);

    const [phases, tasks, milestones] = await Promise.all([
      deps.repos.phases.listByProject(projectId),
      deps.repos.tasks.listByProject(projectId),
      deps.repos.milestones.listByProject(projectId),
    ]);
    const { summary: progress } = await presentPhaseList(deps.repos, projectId, phases);
    const phasesCalculated =
      progress.coverageBasisPoints === null ? 0 : Math.round((progress.coverageBasisPoints * phases.length) / 10000);

    // Entradas de governança (projeto, participantes e perfil institucional) só aparecem para quem pode consultá-las.
    const governanceAllowed = canViewProjectGovernanceAudit(context);
    const recent = (await deps.repos.audit.listRecentByProject(projectId, RECENT_WINDOW))
      .filter((row) => governanceAllowed || !GOVERNANCE_ENTITY_TYPES.has(row.entityType))
      .map(toEapAuditEntryDto);
    const movements = relevantMovements(recent);

    const base: Omit<ExecutiveSummaryDto, "narrative"> = {
      generatedAt: now.toISOString(),
      hasData: phases.length > 0 && tasks.length + milestones.length > 0,
      situation: monitoring.situation,
      progress: {
        basisPoints: progress.progressBasisPoints,
        coverageBasisPoints: progress.coverageBasisPoints,
        phasesTotal: phases.length,
        phasesCalculated,
      },
      overdue: { ...monitoring.overdue, total: monitoring.overdue.phases + monitoring.overdue.tasks + monitoring.overdue.milestones },
      // Mesma contagem do indicador da Visão Geral: tarefas com impedimento registrado.
      impediments: tasks.filter((task) => task.hasImpediment).length,
      reschedules: monitoring.reschedules,
      homologation: {
        awaiting: monitoring.homologation.awaiting,
        inCorrections: monitoring.homologation.inCorrections,
        rejected: monitoring.homologation.rejected,
      },
      nextDeliveries: nextDeliveriesFrom(monitoring.items, new Map(phases.map((phase) => [phase.id, phase.name]))),
      movements,
    };

    return { ...base, narrative: buildNarrative(base) };
  };
}
