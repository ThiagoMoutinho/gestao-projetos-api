import type { EapMilestoneRow } from "../../modules/eap/dtos/eap-milestones.dto";
import type { EapPhaseRow } from "../../modules/eap/dtos/eap-phases.dto";
import type { EapTaskRow } from "../../modules/eap/dtos/eap-tasks.dto";
import { calculatedTaskStatus, derivePhaseStatus } from "../../modules/eap/use-cases/eap-status";

export const RECONCILE_CONFIRMATION = "RECONCILIAR-SITUACOES-EAP";

type TaskFacts = Pick<EapTaskRow, "id" | "phaseId" | "title" | "status" | "progressPercent" | "hasImpediment">;
type PhaseFacts = Pick<EapPhaseRow, "id" | "projectId" | "name" | "status">;
type MilestoneFacts = Pick<EapMilestoneRow, "phaseId" | "status">;

export type TaskChange = {
  taskId: string;
  projectId: string;
  title: string;
  progressPercent: number;
  from: EapTaskRow["status"];
  to: EapTaskRow["status"];
  /** Tarefa legada com situação IMPEDIDA passa a registrar o impedimento só no indicador. */
  markImpediment: boolean;
};

export type PhaseChange = {
  phaseId: string;
  projectId: string;
  name: string;
  from: EapPhaseRow["status"];
  to: EapPhaseRow["status"];
};

export type ReconciliationPlan = { tasks: TaskChange[]; phases: PhaseChange[] };

/**
 * Compara a situação gravada com a regra automática. Não preenche datas antigas:
 * só corrige a situação, e fases suspensas e tarefas canceladas ficam como estão.
 */
export function planReconciliation(input: {
  phases: PhaseFacts[];
  tasks: TaskFacts[];
  milestones: MilestoneFacts[];
}): ReconciliationPlan {
  const projectOfPhase = new Map(input.phases.map((phase) => [phase.id, phase.projectId]));

  const tasks: TaskChange[] = input.tasks.flatMap((task) => {
    const to = calculatedTaskStatus(task);
    if (to === task.status) {
      return [];
    }
    return [
      {
        taskId: task.id,
        projectId: projectOfPhase.get(task.phaseId) ?? "",
        title: task.title,
        progressPercent: task.progressPercent,
        from: task.status,
        to,
        markImpediment: task.status === "IMPEDIDA" && !task.hasImpediment,
      },
    ];
  });

  const reconciledTasks = input.tasks.map((task) => ({
    ...task,
    status: calculatedTaskStatus(task),
  }));

  const phases: PhaseChange[] = input.phases.flatMap((phase) => {
    if (phase.status === "SUSPENSA") {
      return [];
    }
    const to = derivePhaseStatus(
      reconciledTasks.filter((task) => task.phaseId === phase.id),
      input.milestones.filter((milestone) => milestone.phaseId === phase.id),
    );
    return to === phase.status
      ? []
      : [{ phaseId: phase.id, projectId: phase.projectId, name: phase.name, from: phase.status, to }];
  });

  return { tasks, phases };
}

export function formatReconciliationPreview(plan: ReconciliationPlan) {
  const lines = [
    `Tarefas divergentes: ${plan.tasks.length}`,
    ...plan.tasks.map(
      (change) =>
        `  - [${change.projectId}] "${change.title}" (${change.progressPercent}%): ${change.from} → ${change.to}` +
        (change.markImpediment ? " e indicador de impedimento ativado" : ""),
    ),
    `Fases divergentes: ${plan.phases.length}`,
    ...plan.phases.map(
      (change) => `  - [${change.projectId}] "${change.name}": ${change.from} → ${change.to}`,
    ),
    "Datas realizadas antigas não serão preenchidas.",
  ];
  return lines.join("\n");
}
