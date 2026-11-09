import type { AuthUser } from "../../../lib/session";
import { toEapAuditEntryDto } from "../dtos/eap-audit.dto";
import { canValidateExecutiveSummary, canViewProjectGovernanceAudit } from "../eap.authorization";
import type { EapRepos, ExecutiveSummaryValidationRow } from "../repositories/contracts";
import type {
  ExecutiveSummaryDto,
  ExecutiveSummarySnapshotDto,
  ExecutiveSummaryValidationItemDto,
} from "../schemas/eap-executive-summary.schema";
import type { BusinessCalendar } from "../../business-calendar/business-days";
import { executiveCycleOf } from "./executive-cycle";
import { computeExecutiveFollowUp, escalationDueDay, escalationOf, type ProjectStatusEvent } from "./executive-follow-up";
import { executiveSummaryFingerprint } from "./executive-summary-fingerprint";
import { buildNarrative, nextDeliveriesFrom, relevantMovements } from "./executive-summary-narrative";
import { makeGetScheduleMonitoringUseCase } from "./get-schedule-monitoring";
import { presentPhaseList } from "./phase-rollup";
import { assertCanView, loadProjectAccess } from "./shared";

/** Quantos registros recentes são examinados para achar as movimentações relevantes. */
const RECENT_WINDOW = 200;

export function toValidationItemDto(row: ExecutiveSummaryValidationRow): ExecutiveSummaryValidationItemDto {
  return {
    id: row.id,
    kind: row.kind as ExecutiveSummaryValidationItemDto["kind"],
    cycleStart: row.cycleStart,
    cycleEnd: row.cycleEnd,
    validatedAt: row.validatedAt.toISOString(),
    validatedById: row.validatedBy,
    validatedByName: row.validatedByName,
    observation: row.observation,
    unchanged: row.unchanged,
  };
}

/** Limite de validações lidas para saber quais ciclos tiveram validação regular. */
const VALIDATION_WINDOW = 500;
/** Corte de ativação do acompanhamento: desabilitado nesta etapa (parâmetro explícito; a persistência fica para a etapa seguinte). */
const ACTIVATION_CUTOFF: string | null = null;

/**
 * Eventos auditados que sustentam o acompanhamento: mudanças de situação do projeto (inclusive a situação inicial na
 * criação) e o primeiro andamento registrado (fase ou tarefa que saiu de "não iniciada", ou entrega de marco).
 */
export async function loadFollowUpEvidence(repos: EapRepos, projectId: string) {
  const entries = await repos.audit.listByAction({ projectId, action: "STATUS_CHANGE" });
  const projectEvents: ProjectStatusEvent[] = [];
  let firstActivityAt: Date | null = null;
  for (const entry of entries) {
    const payload = (entry.payload ?? {}) as { from?: unknown; to?: unknown; automatic?: unknown; kind?: unknown };
    if (entry.entityType === "PROJECT") {
      if (payload.automatic !== true && typeof payload.to === "string") {
        projectEvents.push({ at: entry.createdAt, from: typeof payload.from === "string" ? payload.from : null, to: payload.to });
      }
      continue;
    }
    const started =
      (entry.entityType === "PHASE" || entry.entityType === "TASK") &&
      payload.from === "NAO_INICIADA" &&
      (payload.to === "EM_ANDAMENTO" || payload.to === "CONCLUIDA");
    if ((started || payload.kind === "DELIVER") && (firstActivityAt === null || entry.createdAt < firstActivityAt)) {
      firstActivityAt = entry.createdAt;
    }
  }
  return { projectEvents, firstActivityAt };
}

/**
 * Monta os indicadores do resumo executivo automático (somente leitura). Reaproveita o monitoramento de prazos (situação,
 * atrasos, reprogramações e homologação, com a mesma autorização de consulta), o cálculo de andamento das fases e do
 * projeto usado pela EAP e a auditoria do projeto. A narrativa só combina esses números com frases predefinidas.
 * Usado pela consulta e, dentro da transação, pela validação do PMO (o servidor recalcula sempre).
 */
export function makeBuildExecutiveSummary(deps: { repos: EapRepos }) {
  const monitoringOf = makeGetScheduleMonitoringUseCase(deps);

  return async function buildExecutiveSummary(actor: AuthUser, projectId: string, now: Date) {
    // A consulta do monitoramento já confere o acesso ao projeto; o resumo mantém a mesma regra.
    const monitoring = await monitoringOf(actor, projectId, now);
    const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
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
    const recent = (await deps.repos.audit.listRecentByProject(projectId, RECENT_WINDOW)).map(toEapAuditEntryDto);
    const movements = relevantMovements(recent).filter((movement) => governanceAllowed || !movement.governance);

    const base: Omit<ExecutiveSummarySnapshotDto, "narrative"> = {
      generatedAt: now.toISOString(),
      hasData: phases.length > 0 && tasks.length + milestones.length > 0,
      situation: monitoring.situation,
      progress: {
        basisPoints: progress.progressBasisPoints,
        coverageBasisPoints: progress.coverageBasisPoints,
        phasesTotal: phases.length,
        phasesCalculated,
      },
      // Mesma contagem da Situação atual (regra única de atraso): tarefas e marcos; fases não entram.
      overdue: { ...monitoring.overdue, total: monitoring.overdue.tasks + monitoring.overdue.milestones },
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

    const snapshot: ExecutiveSummarySnapshotDto = { ...base, narrative: buildNarrative(base) };
    return { snapshot, fingerprint: executiveSummaryFingerprint(base), project, context };
  };
}

/** Consulta do resumo: indicadores automáticos (sempre atualizados) e a governança da validação do PMO (separada). */
export function makeGetExecutiveSummaryUseCase(deps: {
  repos: EapRepos;
  /** Calendário institucional (só consultado quando o escalonamento depende de dias úteis). */
  loadCalendar?: (from: string, to: string) => Promise<BusinessCalendar>;
}) {
  const build = makeBuildExecutiveSummary(deps);

  return async function getExecutiveSummary(actor: AuthUser, projectId: string, now = new Date()): Promise<ExecutiveSummaryDto> {
    const { snapshot, fingerprint, project, context } = await build(actor, projectId, now);
    const cycle = executiveCycleOf(now);
    const [latest, regular, validations, evidence] = await Promise.all([
      deps.repos.executiveSummaries.findLatestByProject(projectId),
      deps.repos.executiveSummaries.findRegularInCycle(projectId, cycle.start),
      deps.repos.executiveSummaries.listByProject(projectId, VALIDATION_WINDOW),
      loadFollowUpEvidence(deps.repos, projectId),
    ]);
    const core = computeExecutiveFollowUp({
      now,
      projectStatus: project.status,
      ...evidence,
      regularCycleStarts: new Set(validations.filter((row) => row.kind === "REGULAR").map((row) => row.cycleStart)),
      activationCutoff: ACTIVATION_CUTOFF,
    });
    // Os detalhes de escalonamento são de governança: só quem pode consultá-la os vê.
    const due = canViewProjectGovernanceAudit(context) ? escalationDueDay(core) : null;
    const calendar = due !== null && deps.loadCalendar ? await deps.loadCalendar(due, due) : null;
    const escalation =
      due === null
        ? { status: "NAO_APLICAVEL" as const, eligibleAt: null, calendarPendingYears: [] }
        : escalationOf(core, now, calendar);

    return {
      ...snapshot,
      governance: {
        followUp: { ...core, escalation },
        cycle,
        // Concluídos e suspensos ficam fora das cobranças periódicas; a validação manual continua permitida.
        periodic: project.status !== "CONCLUIDO" && project.status !== "SUSPENSO",
        currentCycleRegularValidated: regular !== null,
        lastValidation: latest ? toValidationItemDto(latest) : null,
        canValidate: canValidateExecutiveSummary(context),
        fingerprint,
        unchangedSinceLastValidation: latest !== null && latest.fingerprint === fingerprint,
      },
    };
  };
}
