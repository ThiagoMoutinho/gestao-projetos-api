import type { EapMilestoneRow } from "../dtos/eap-milestones.dto";
import type { EapPhaseRow } from "../dtos/eap-phases.dto";
import type { EapTaskRow } from "../dtos/eap-tasks.dto";

export type TaskStatus = EapTaskRow["status"];
export type PhaseStatus = EapPhaseRow["status"];

type TaskFacts = Pick<EapTaskRow, "status" | "progressPercent" | "weight">;
type MilestoneFacts = Pick<EapMilestoneRow, "status">;

export type PhaseProgress =
  | { state: "VALUE"; basisPoints: number }
  | { state: "EMPTY"; basisPoints: null }
  | { state: "NO_ELIGIBLE"; basisPoints: null };

const MILESTONE_WEIGHT = 1;

/**
 * Andamento do marco (decisão do PMO): entregue conta 50%, aceito 100%. Pendente, rejeitado ou com
 * correções solicitadas contam 0%. A fase só é concluída com o aceite, nunca apenas com a entrega.
 */
export function milestonePercent(status: MilestoneFacts["status"]) {
  if (status === "APROVADO") return 100;
  if (status === "ENTREGUE") return 50;
  return 0;
}

/** 0% → Não iniciada; 1–99% → Em andamento; 100% → Concluída. Cancelamento é decisão explícita e não é derivado. */
export function deriveTaskStatus(progressPercent: number): Exclude<TaskStatus, "CANCELADA" | "IMPEDIDA"> {
  if (progressPercent >= 100) {
    return "CONCLUIDA";
  }
  return progressPercent > 0 ? "EM_ANDAMENTO" : "NAO_INICIADA";
}

export function calculatedTaskStatus(task: Pick<EapTaskRow, "status" | "progressPercent">): TaskStatus {
  return task.status === "CANCELADA" ? "CANCELADA" : deriveTaskStatus(task.progressPercent);
}

/**
 * Situação de execução da fase a partir dos itens subordinados. Tarefas canceladas não contam.
 * Concluída exige todas as tarefas concluídas e todos os marcos aprovados: entrega sem aceite não conclui.
 */
export function derivePhaseStatus(
  tasks: ReadonlyArray<Pick<TaskFacts, "status" | "progressPercent">>,
  milestones: ReadonlyArray<MilestoneFacts>,
): Exclude<PhaseStatus, "SUSPENSA"> {
  const eligible = tasks.filter((task) => task.status !== "CANCELADA");
  if (eligible.length === 0 && milestones.length === 0) {
    return "NAO_INICIADA";
  }

  const allTasksDone = eligible.every((task) => calculatedTaskStatus(task) === "CONCLUIDA");
  const allMilestonesAccepted = milestones.every((milestone) => milestone.status === "APROVADO");
  if (allTasksDone && allMilestonesAccepted) {
    return "CONCLUIDA";
  }

  const moved =
    eligible.some((task) => task.progressPercent > 0) ||
    milestones.some((milestone) => milestone.status !== "PENDENTE");
  return moved ? "EM_ANDAMENTO" : "NAO_INICIADA";
}

export function calculatedPhaseStatus(
  phase: Pick<EapPhaseRow, "status">,
  tasks: ReadonlyArray<Pick<TaskFacts, "status" | "progressPercent">>,
  milestones: ReadonlyArray<MilestoneFacts>,
): PhaseStatus {
  return phase.status === "SUSPENSA" ? "SUSPENSA" : derivePhaseStatus(tasks, milestones);
}

/** Média ponderada: tarefa pelo peso (mínimo 1); marco com peso 1, 50% entregue e 100% aceito. */
export function phaseProgress(
  tasks: ReadonlyArray<TaskFacts>,
  milestones: ReadonlyArray<MilestoneFacts>,
): PhaseProgress {
  if (tasks.length === 0 && milestones.length === 0) {
    return { state: "EMPTY", basisPoints: null };
  }

  let weighted = 0;
  let weights = 0;
  for (const task of tasks) {
    if (task.status === "CANCELADA") {
      continue;
    }
    const weight = task.weight >= 1 ? task.weight : 1;
    weighted += task.progressPercent * weight;
    weights += weight;
  }
  for (const milestone of milestones) {
    weighted += milestonePercent(milestone.status) * MILESTONE_WEIGHT;
    weights += MILESTONE_WEIGHT;
  }

  if (weights === 0) {
    return { state: "NO_ELIGIBLE", basisPoints: null };
  }
  return { state: "VALUE", basisPoints: Math.round((weighted * 100) / weights) };
}

export type PhaseDates = {
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
};

type DatedTask = Pick<EapTaskRow, "status" | "plannedStartAt" | "plannedEndAt" | "actualStartAt" | "actualEndAt">;
type DatedMilestone = Pick<EapMilestoneRow, "status" | "plannedAt" | "actualAt">;

function earliest(values: ReadonlyArray<Date | null>) {
  return values.reduce<Date | null>((min, value) => (value && (!min || value < min) ? value : min), null);
}

function latest(values: ReadonlyArray<Date | null>) {
  return values.reduce<Date | null>((max, value) => (value && (!max || value > max) ? value : max), null);
}

/**
 * Datas da fase calculadas pelos itens (tarefas canceladas não contam; o marco tem data única):
 * início planejado = menor início das tarefas (ou o primeiro marco, se não houver tarefa datada);
 * término planejado = maior término das tarefas ou o último marco, se posterior;
 * início real = menor início real das tarefas;
 * término real = só com a fase formalmente concluída: maior término real das tarefas ou a data
 * efetiva do último marco aceito. Sem itens datados, as datas ficam não informadas.
 */
export function phaseDates(
  tasks: ReadonlyArray<DatedTask>,
  milestones: ReadonlyArray<DatedMilestone>,
  concluded: boolean,
): PhaseDates {
  const active = tasks.filter((task) => task.status !== "CANCELADA");
  const milestoneDates = milestones.map((milestone) => milestone.plannedAt);
  return {
    plannedStartAt: earliest([...active.map((task) => task.plannedStartAt), ...milestoneDates]),
    plannedEndAt: latest([...active.map((task) => task.plannedEndAt), ...milestoneDates]),
    actualStartAt: earliest(active.map((task) => task.actualStartAt)),
    actualEndAt: concluded
      ? latest([
          ...active.map((task) => task.actualEndAt),
          ...milestones.filter((milestone) => milestone.status === "APROVADO").map((milestone) => milestone.actualAt),
        ])
      : null,
  };
}

/** Média simples das fases com valor calculável; a cobertura indica quantas fases entraram no cálculo. */
export type ProjectProgress = {
  progressBasisPoints: number | null;
  coverageBasisPoints: number | null;
};

export function projectProgress(progresses: ReadonlyArray<PhaseProgress>): ProjectProgress {
  const values = progresses.filter((item) => item.state === "VALUE").map((item) => item.basisPoints as number);
  return {
    progressBasisPoints:
      values.length === 0 ? null : Math.round(values.reduce((total, value) => total + value, 0) / values.length),
    coverageBasisPoints:
      progresses.length === 0 ? null : Math.round((values.length * 10000) / progresses.length),
  };
}

/** Datas civis seguem o fuso de Belém e são gravadas ao meio-dia local, como no restante da aplicação. */
export function civilToday(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${day}T12:00:00.000-03:00`);
}

/** Dia civil (AAAA-MM-DD) no fuso de Belém, comparável como texto. */
export function civilDayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isFutureCivilDate(value: Date, now = new Date()) {
  return civilDayKey(value) > civilDayKey(now);
}

/**
 * Cumprimento de prazo, separado da situação do item. Concluir dentro de um prazo reprogramado
 * não equivale a concluir no prazo original: a distinção é preservada para os painéis do PMO.
 */
export type DeadlinePerformance =
  | "DONE_ON_ORIGINAL"
  | "DONE_ON_RESCHEDULED"
  | "DONE_LATE"
  | "OPEN_ON_TIME"
  | "OPEN_ON_RESCHEDULED"
  | "OPEN_OVERDUE";

export const DEADLINE_PERFORMANCES: readonly DeadlinePerformance[] = [
  "DONE_ON_ORIGINAL",
  "DONE_ON_RESCHEDULED",
  "DONE_LATE",
  "OPEN_ON_TIME",
  "OPEN_ON_RESCHEDULED",
  "OPEN_OVERDUE",
];

export function deadlinePerformance(
  item: {
    state: "OPEN" | "DONE" | "CLOSED";
    baselineEndAt: Date | null;
    plannedEndAt: Date | null;
    actualEndAt: Date | null;
  },
  now = new Date(),
): DeadlinePerformance | null {
  if (item.state === "CLOSED" || !item.plannedEndAt) {
    return null;
  }
  const planned = civilDayKey(item.plannedEndAt);
  const original = civilDayKey(item.baselineEndAt ?? item.plannedEndAt);

  if (item.state === "DONE") {
    if (!item.actualEndAt) {
      return null;
    }
    const actual = civilDayKey(item.actualEndAt);
    if (actual > planned) {
      return "DONE_LATE";
    }
    return actual <= original ? "DONE_ON_ORIGINAL" : "DONE_ON_RESCHEDULED";
  }

  const today = civilDayKey(now);
  if (today > planned) {
    return "OPEN_OVERDUE";
  }
  return today > original ? "OPEN_ON_RESCHEDULED" : "OPEN_ON_TIME";
}
