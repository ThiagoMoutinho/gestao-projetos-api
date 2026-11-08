import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapPhaseRow } from "../dtos/eap-phases.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";
import { dayDiff, type EapDelays } from "./eap-delay";
import { calculatedTaskStatus, civilDayKey } from "./eap-status";
import type { ProjectSituation } from "./project-situation";

export type DeadlineSituationStatus = "CONCLUIDO" | "ATRASADO" | "EM_ATENCAO" | "NO_PRAZO";

export type DeadlineRiskReason = "ACTIVE_IMPEDIMENT" | "NOT_STARTED_AFTER_PLANNED_START";

export type DeadlineAttentionItem = {
  entityType: "TASK" | "MILESTONE";
  entityId: string;
  reason: DeadlineRiskReason;
};

/** Indicadores previstos no critério que ainda não têm registro no sistema: não são presumidos. */
export type UnevaluatedDeadlineIndicator = "DEPENDENCIES" | "FORMAL_RISKS";

export type DeadlineSituation = {
  /** Situação do prazo; `null` em projeto suspenso, que fica fora dos quatro estados. */
  status: DeadlineSituationStatus | null;
  /** Sem nenhum compromisso datado, "No prazo" significa só que nada foi identificado, não que o prazo foi validado. */
  hasDatedCommitments: boolean;
  overdueCommitments: number;
  attentionItems: DeadlineAttentionItem[];
  unevaluatedIndicators: UnevaluatedDeadlineIndicator[];
};

/** Janela, em dias corridos a partir de hoje (inclusive), em que um compromisso com risco objetivo pede atenção. */
export const DEADLINE_ATTENTION_WINDOW_DAYS = 30;

const UNEVALUATED_INDICATORS: UnevaluatedDeadlineIndicator[] = ["DEPENDENCIES", "FORMAL_RISKS"];

/**
 * Situação do prazo do módulo Planejamento, independente da situação executiva do projeto, pela prioridade
 * aprovada: Concluído, Atrasado, Em atenção e No prazo. Usa só as datas vigentes e os registros oficiais.
 *
 * - Concluído: encerramento formal já reconhecido pela situação do projeto.
 * - Atrasado: item em atraso pela regra única (eap-delay.ts) ou prazo final do projeto vencido.
 * - Em atenção: compromisso que vence na janela e tem indicador objetivo de risco. A proximidade, sozinha, não é
 *   risco. Tarefa: impedimento ativo, ou início planejado passado sem início registrado. Marco: impedimento ativo
 *   em tarefa corretiva vinculada a ele. Marco entregue depende da homologação, não da execução, e fica de fora.
 *
 * O número de reprogramações não entra no cálculo.
 */
export function deadlineSituation(input: {
  situationStatus: ProjectSituation["status"];
  projectPlannedEndAt: Date | null;
  phases: ReadonlyArray<Pick<EapPhaseRow, "id" | "status">>;
  tasks: ReadonlyArray<EapTaskRow>;
  milestones: ReadonlyArray<EapMilestoneRow>;
  delays: Pick<EapDelays, "items">;
  now?: Date;
}): DeadlineSituation {
  const today = civilDayKey(input.now ?? new Date());
  const suspendedPhases = new Set(input.phases.filter((phase) => phase.status === "SUSPENSA").map((phase) => phase.id));
  const tasks = input.tasks.filter((task) => !suspendedPhases.has(task.phaseId));
  const milestones = input.milestones.filter((milestone) => !suspendedPhases.has(milestone.phaseId));
  const openTasks = tasks.filter((task) => {
    const status = calculatedTaskStatus(task);
    return status !== "CONCLUIDA" && status !== "CANCELADA";
  });

  const hasDatedCommitments =
    input.projectPlannedEndAt !== null ||
    milestones.some((milestone) => milestone.plannedAt !== null) ||
    tasks.some((task) => task.status !== "CANCELADA" && task.plannedEndAt !== null);

  const dueInWindow = (value: Date | null) => {
    if (!value) {
      return false;
    }
    const days = dayDiff(civilDayKey(value), today);
    return days >= 0 && days <= DEADLINE_ATTENTION_WINDOW_DAYS;
  };

  const attentionItems: DeadlineAttentionItem[] = [];
  for (const task of openTasks) {
    if (!dueInWindow(task.plannedEndAt)) {
      continue;
    }
    if (task.hasImpediment) {
      attentionItems.push({ entityType: "TASK", entityId: task.id, reason: "ACTIVE_IMPEDIMENT" });
    }
    const missedStart = task.plannedStartAt !== null && civilDayKey(task.plannedStartAt) < today;
    if (missedStart && task.progressPercent === 0 && task.actualStartAt === null) {
      attentionItems.push({ entityType: "TASK", entityId: task.id, reason: "NOT_STARTED_AFTER_PLANNED_START" });
    }
  }
  for (const milestone of milestones) {
    if (milestone.status === "APROVADO" || milestone.status === "ENTREGUE" || !dueInWindow(milestone.plannedAt)) {
      continue;
    }
    if (openTasks.some((task) => task.correctiveMilestoneId === milestone.id && task.hasImpediment)) {
      attentionItems.push({ entityType: "MILESTONE", entityId: milestone.id, reason: "ACTIVE_IMPEDIMENT" });
    }
  }

  const projectOverdue = input.projectPlannedEndAt !== null && civilDayKey(input.projectPlannedEndAt) < today;
  const overdueCommitments = input.delays.items.length + (projectOverdue ? 1 : 0);

  const status: DeadlineSituationStatus | null =
    input.situationStatus === "SUSPENSO"
      ? null
      : input.situationStatus === "CONCLUIDO"
        ? "CONCLUIDO"
        : overdueCommitments > 0
          ? "ATRASADO"
          : attentionItems.length > 0
            ? "EM_ATENCAO"
            : "NO_PRAZO";

  return { status, hasDatedCommitments, overdueCommitments, attentionItems, unevaluatedIndicators: UNEVALUATED_INDICATORS };
}
