import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapPhaseRow, PhaseRollup } from "../dtos/eap-phases.dto";
import { toEapPhaseDto } from "../dtos/eap-phases.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";
import type { EapRepos } from "../repositories/contracts";
import {
  calculatedPhaseStatus,
  derivePhaseStatus,
  phaseDates,
  phaseProgress,
  projectProgress,
} from "./eap-status";

function rollupOf(phase: EapPhaseRow, tasks: EapTaskRow[], milestones: EapMilestoneRow[]): PhaseRollup {
  const calculatedStatus = calculatedPhaseStatus(phase, tasks, milestones);
  return {
    calculatedStatus,
    progress: phaseProgress(tasks, milestones),
    dates: phaseDates(tasks, milestones, calculatedStatus === "CONCLUIDA"),
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
 * Só as datas reais acompanham os itens. O planejamento da fase (vigente e linha de base) é o
 * gravado e muda apenas por reprogramação justificada; nunca é sobrescrito pelo recálculo.
 */
const DATE_FIELDS = ["actualStartAt", "actualEndAt"] as const;

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

/**
 * Recalcula a situação e as datas reais da fase depois de uma mudança em tarefa ou marco, na mesma
 * transação. Fase suspensa mantém a situação; as datas reais vazias continuam sendo preenchidas.
 * Toda mudança fica no histórico como automática.
 */
export async function syncPhaseStatus(
  repos: EapRepos,
  input: { projectId: string; phaseId: string; actorId: string; cause: string; resume?: boolean },
) {
  const phase = await repos.phases.lockForUpdate(input.phaseId, input.projectId);
  if (!phase) {
    return phase;
  }

  const tasks = await repos.tasks.listByPhase(phase.id);
  const milestones = await repos.milestones.listByPhase(phase.id);
  const frozen = phase.status === "SUSPENSA" && !input.resume;
  const next = frozen ? phase.status : derivePhaseStatus(tasks, milestones);
  const calculated = phaseDates(tasks, milestones, next === "CONCLUIDA");
  // Data real gravada é preservada; o recálculo só preenche campo vazio com a data indicada pelos itens.
  // Reabrir a fase remove o término real, que deixaria de ser compatível com a execução em andamento.
  const reopened = phase.status === "CONCLUIDA" && next !== "CONCLUIDA";
  const dates = {
    actualStartAt: phase.actualStartAt ?? calculated.actualStartAt,
    actualEndAt: reopened ? null : (phase.actualEndAt ?? calculated.actualEndAt),
  };
  const changedDates = DATE_FIELDS.filter((field) => iso(dates[field]) !== iso(phase[field]));
  const statusChanged = next !== phase.status;
  if (!statusChanged && changedDates.length === 0) {
    return phase;
  }

  const updated = await repos.phases.update(phase.id, input.projectId, {
    ...(statusChanged ? { status: next } : {}),
    actualStartAt: dates.actualStartAt,
    actualEndAt: dates.actualEndAt,
    updatedBy: input.actorId,
    updatedAt: new Date(),
  });

  const dateChanges = Object.fromEntries(
    changedDates.map((field) => [field, { previous: iso(phase[field]), next: iso(dates[field]) }]),
  );
  await repos.audit.create({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    entityType: "PHASE",
    entityId: phase.id,
    action: statusChanged ? "STATUS_CHANGE" : "UPDATE",
    summary: statusChanged
      ? input.resume
        ? `Fase "${phase.name}" retomada.`
        : `Situação da fase "${phase.name}" atualizada automaticamente.`
      : `Datas reais vazias da fase "${phase.name}" preenchidas pelas tarefas e marcos.`,
    payload: {
      automatic: !input.resume,
      ...(statusChanged ? { from: phase.status, to: next } : { kind: "CALCULATED_DATES" }),
      cause: input.cause,
      ...(changedDates.length > 0 ? { dates: dateChanges } : {}),
    },
    actorId: input.actorId,
  });

  return updated;
}
