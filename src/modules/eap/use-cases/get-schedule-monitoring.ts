import type { AuthUser } from "../../../lib/session";
import type { EapMilestoneDeliveryRow } from "../dtos/eap-milestone-deliveries.dto";
import {
  isRescheduleEntry,
  toEapScheduleChangeDto,
  type EapScheduleMonitoringDto,
} from "../dtos/eap-schedule.dto";
import type { EapRepos } from "../repositories/contracts";
import { calculatedTaskStatus, civilDayKey, deadlinePerformance } from "./eap-status";
import { assertCanView, loadProjectAccess, usesDeliveryRounds } from "./shared";

type MonitoredItem = EapScheduleMonitoringDto["items"][number];

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

/**
 * Indicadores de prazo e homologação do projeto para painéis futuros. Tudo é derivado dos registros
 * existentes: datas vigentes e originais, auditoria de reprogramações e rodadas de homologação.
 */
export function makeGetScheduleMonitoringUseCase(deps: { repos: EapRepos }) {
  return async function getScheduleMonitoring(
    actor: AuthUser,
    projectId: string,
    now = new Date(),
  ): Promise<EapScheduleMonitoringDto> {
    const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);

    const [phaseRows, tasks, milestones, deliveries, scheduleEntries, decisions] = await Promise.all([
      deps.repos.phases.listByProject(projectId),
      deps.repos.tasks.listByProject(projectId),
      deps.repos.milestones.listByProject(projectId),
      deps.repos.deliveries.listByProject(projectId),
      deps.repos.audit.listByAction({ projectId, action: "SCHEDULE_CHANGE" }),
      deps.repos.audit.listByAction({ projectId, action: "VALIDATE" }),
    ]);

    // Planejamento, linha de base e datas reais: os gravados na fase, como na EAP.
    const phases = phaseRows;

    const today = civilDayKey(now);
    const isPast = (value: Date | null) => value !== null && civilDayKey(value) < today;

    const reschedules = scheduleEntries.filter(isRescheduleEntry).map(toEapScheduleChangeDto);
    const countFor = (entityType: string, entityId: string) =>
      reschedules.filter((entry) => entry.entityType === entityType && entry.entityId === entityId).length;

    const items: MonitoredItem[] = [
      ...phases.map((phase) => ({
        entityType: "PHASE" as const,
        entityId: phase.id,
        phaseId: phase.id,
        title: phase.name,
        status: phase.status,
        milestoneType: null,
        baselineStartAt: iso(phase.baselineStartAt),
        baselineEndAt: iso(phase.baselineEndAt),
        plannedStartAt: iso(phase.plannedStartAt),
        plannedEndAt: iso(phase.plannedEndAt),
        actualStartAt: iso(phase.actualStartAt),
        actualEndAt: iso(phase.actualEndAt),
        overdue: phase.status !== "CONCLUIDA" && isPast(phase.plannedEndAt),
        deadlinePerformance: deadlinePerformance(
          {
            state: phase.status === "CONCLUIDA" ? "DONE" : "OPEN",
            baselineEndAt: phase.baselineEndAt,
            plannedEndAt: phase.plannedEndAt,
            actualEndAt: phase.actualEndAt,
          },
          now,
        ),
        rescheduleCount: countFor("PHASE", phase.id),
        responsibleId: phase.responsibleId,
        responsibleName: null,
      })),
      ...tasks.map((task) => {
        const status = calculatedTaskStatus(task);
        return {
          entityType: "TASK" as const,
          entityId: task.id,
          phaseId: task.phaseId,
          title: task.title,
          status,
          milestoneType: null,
          baselineStartAt: iso(task.baselineStartAt),
          baselineEndAt: iso(task.baselineEndAt),
          plannedStartAt: iso(task.plannedStartAt),
          plannedEndAt: iso(task.plannedEndAt),
          actualStartAt: iso(task.actualStartAt),
          actualEndAt: iso(task.actualEndAt),
          overdue: status !== "CONCLUIDA" && status !== "CANCELADA" && isPast(task.plannedEndAt),
          deadlinePerformance: deadlinePerformance(
            {
              state: status === "CONCLUIDA" ? "DONE" : status === "CANCELADA" ? "CLOSED" : "OPEN",
              baselineEndAt: task.baselineEndAt,
              plannedEndAt: task.plannedEndAt,
              actualEndAt: task.actualEndAt,
            },
            now,
          ),
          rescheduleCount: countFor("TASK", task.id),
          responsibleId: task.assigneeId,
          responsibleName: null,
        };
      }),
      ...milestones.map((milestone) => ({
        entityType: "MILESTONE" as const,
        entityId: milestone.id,
        phaseId: milestone.phaseId,
        title: milestone.title,
        status: milestone.status,
        milestoneType: milestone.type,
        baselineStartAt: null,
        baselineEndAt: iso(milestone.baselineAt),
        plannedStartAt: null,
        plannedEndAt: iso(milestone.plannedAt),
        actualStartAt: null,
        actualEndAt: iso(milestone.actualAt),
        overdue: milestone.status !== "APROVADO" && isPast(milestone.plannedAt),
        deadlinePerformance: deadlinePerformance(
          {
            state: milestone.status === "APROVADO" ? "DONE" : "OPEN",
            baselineEndAt: milestone.baselineAt,
            plannedEndAt: milestone.plannedAt,
            actualEndAt: milestone.actualAt,
          },
          now,
        ),
        rescheduleCount: countFor("MILESTONE", milestone.id),
        responsibleId:
          milestone.status === "ENTREGUE" ? milestone.reviewerId : (milestone.presenterId ?? milestone.deliveredBy),
        responsibleName: null,
      })),
    ];

    const roundsByMilestone = new Map<string, EapMilestoneDeliveryRow[]>();
    for (const delivery of deliveries) {
      roundsByMilestone.set(delivery.milestoneId, [
        ...(roundsByMilestone.get(delivery.milestoneId) ?? []),
        delivery,
      ]);
    }

    const homologationMilestones = milestones
      .filter((milestone) => usesDeliveryRounds(milestone.type))
      .map((milestone) => {
        const rounds = roundsByMilestone.get(milestone.id) ?? [];
        const accepted = rounds.find((round) => round.status === "ACEITA");
        return {
          milestoneId: milestone.id,
          phaseId: milestone.phaseId,
          title: milestone.title,
          type: milestone.type,
          status: milestone.status,
          attempts: rounds.length,
          rejections: rounds.filter((round) => round.status === "REJEITADA").length,
          correctionRequests: rounds.filter((round) => round.status === "AJUSTES_SOLICITADOS").length,
          attemptsUntilHomologation: accepted ? accepted.round : null,
          reviewerId: milestone.reviewerId,
          reviewerName: null as string | null,
        };
      });

    const personIds = new Set<string>();
    for (const item of items) {
      if (item.responsibleId) personIds.add(item.responsibleId);
    }
    for (const item of homologationMilestones) {
      if (item.reviewerId) personIds.add(item.reviewerId);
    }
    const people = await Promise.all([...personIds].map((id) => deps.repos.users.findById(id)));
    const nameOf = (id: string | null) => people.find((person) => person?.id === id)?.name ?? null;
    for (const item of items) item.responsibleName = nameOf(item.responsibleId);
    for (const item of homologationMilestones) item.reviewerName = nameOf(item.reviewerId);

    const startedPhases = phases.filter((phase) => phase.actualStartAt);
    const allPhasesDone = phases.length > 0 && phases.every((phase) => phase.status === "CONCLUIDA");
    const actualStart = startedPhases.reduce<Date | null>(
      (earliest, phase) =>
        !earliest || (phase.actualStartAt as Date) < earliest ? (phase.actualStartAt as Date) : earliest,
      null,
    );
    const actualEnd = allPhasesDone
      ? phases.reduce<Date | null>(
          (latest, phase) =>
            phase.actualEndAt && (!latest || phase.actualEndAt > latest) ? phase.actualEndAt : latest,
          null,
        )
      : null;

    return {
      project: {
        baselineStartAt: iso(project.baselineStartAt),
        baselineEndAt: iso(project.baselineEndAt),
        plannedStartAt: iso(project.plannedStartAt),
        plannedEndAt: iso(project.plannedEndAt),
        actualStartAt: iso(actualStart),
        actualEndAt: iso(actualEnd),
        overdue: project.status !== "CONCLUIDO" && isPast(project.plannedEndAt),
        rescheduleCount: countFor("PROJECT", project.id),
      },
      reschedules: {
        total: reschedules.length,
        escalated: reschedules.filter((entry) => entry.escalatedToPmo).length,
        affectingCriticalMilestones: reschedules.filter((entry) =>
          entry.impacts.some((impact) => impact.code === "CRITICAL_MILESTONE"),
        ).length,
      },
      overdue: {
        phases: items.filter((item) => item.entityType === "PHASE" && item.overdue).length,
        tasks: items.filter((item) => item.entityType === "TASK" && item.overdue).length,
        milestones: items.filter((item) => item.entityType === "MILESTONE" && item.overdue).length,
      },
      homologation: {
        awaiting: milestones.filter((milestone) => milestone.status === "ENTREGUE").length,
        inCorrections: milestones.filter((milestone) => milestone.status === "AJUSTES_SOLICITADOS").length,
        rejected: milestones.filter((milestone) => milestone.status === "REJEITADO").length,
        rejectionDecisions: decisions.filter(
          (entry) => (entry.payload as Record<string, unknown> | null)?.to === "REJEITADO",
        ).length,
        milestones: homologationMilestones,
      },
      items,
    };
  };
}
