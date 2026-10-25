import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapPhaseRow, PhaseRollup } from "../dtos/eap-phases.dto";
import { toEapPhaseDto } from "../dtos/eap-phases.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";
import type { EapRepos } from "../repositories/contracts";
import {
  calculatedPhaseStatus,
  civilToday,
  derivePhaseStatus,
  phaseProgress,
  projectProgress,
} from "./eap-status";

function rollupOf(phase: EapPhaseRow, tasks: EapTaskRow[], milestones: EapMilestoneRow[]): PhaseRollup {
  return {
    calculatedStatus: calculatedPhaseStatus(phase, tasks, milestones),
    progress: phaseProgress(tasks, milestones),
  };
}

export async function presentPhase(repos: EapRepos, phase: EapPhaseRow) {
  const tasks = await repos.tasks.listByPhase(phase.id);
  const milestones = await repos.milestones.listByPhase(phase.id);
  return toEapPhaseDto(phase, rollupOf(phase, tasks, milestones));
}

export async function presentPhaseList(repos: EapRepos, projectId: string, phases: EapPhaseRow[]) {
  const tasks = await repos.tasks.listByProject(projectId);
  const milestones = await repos.milestones.listByProject(projectId);
  const rollups = phases.map((phase) =>
    rollupOf(
      phase,
      tasks.filter((task) => task.phaseId === phase.id),
      milestones.filter((milestone) => milestone.phaseId === phase.id),
    ),
  );

  return {
    data: phases.map((phase, index) => toEapPhaseDto(phase, rollups[index])),
    summary: projectProgress(rollups.map((rollup) => rollup.progress)),
  };
}

/**
 * Recalcula a situação da fase depois de uma mudança em tarefa ou marco, dentro da mesma transação.
 * Fase suspensa não é alterada. Toda mudança fica no histórico como automática.
 */
export async function syncPhaseStatus(
  repos: EapRepos,
  input: { projectId: string; phaseId: string; actorId: string; cause: string; resume?: boolean },
) {
  const phase = await repos.phases.lockForUpdate(input.phaseId, input.projectId);
  if (!phase || (phase.status === "SUSPENSA" && !input.resume)) {
    return phase;
  }

  const tasks = await repos.tasks.listByPhase(phase.id);
  const milestones = await repos.milestones.listByPhase(phase.id);
  const next = derivePhaseStatus(tasks, milestones);
  if (next === phase.status) {
    return phase;
  }

  const today = civilToday();
  const dates: { actualStartAt?: Date | null; actualEndAt?: Date | null } = {};
  if (next !== "NAO_INICIADA" && !phase.actualStartAt) {
    dates.actualStartAt = today;
  }
  if (next === "CONCLUIDA" && !phase.actualEndAt) {
    dates.actualEndAt = today;
  }
  if (next !== "CONCLUIDA" && phase.status === "CONCLUIDA" && phase.actualEndAt) {
    dates.actualEndAt = null;
  }

  const updated = await repos.phases.update(phase.id, input.projectId, {
    status: next,
    ...dates,
    updatedBy: input.actorId,
    updatedAt: new Date(),
  });

  await repos.audit.create({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    entityType: "PHASE",
    entityId: phase.id,
    action: "STATUS_CHANGE",
    summary: input.resume
      ? `Fase "${phase.name}" retomada.`
      : `Situação da fase "${phase.name}" atualizada automaticamente.`,
    payload: {
      automatic: !input.resume,
      from: phase.status,
      to: next,
      cause: input.cause,
      ...(dates.actualStartAt !== undefined ? { actualStartAt: dates.actualStartAt } : {}),
      ...(dates.actualEndAt !== undefined
        ? { actualEndAt: dates.actualEndAt, previousActualEndAt: phase.actualEndAt }
        : {}),
    },
    actorId: input.actorId,
  });

  return updated;
}
